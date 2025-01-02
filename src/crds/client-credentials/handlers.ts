import z from "npm:zod";
import { k8sApiMC, watcher } from "../../k8s.ts";
import { Logger } from "../../util.ts";
import {
  CUSTOMRESOURCE_GROUP,
  CUSTOMRESOURCE_PLURAL,
  CUSTOMRESOURCE_VERSION,
  zCrdStatusOut,
  zCustomResourceIn,
} from "./schemas.ts";
import process from "node:process";
import { reconcileResource } from "./reconciler.ts";
import { scheduleJobNow as scheduleSecretsCleanupJobNow } from "./secretsCleanupQueue.ts";
import { generateCrAnnotations, validateCrHash } from '../crd-mgmt-utils.ts';

const logger = new Logger('client-credentials crd handler')

async function onEvent(
  _phase: string,
  apiObj: object,
) {
  const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
  const parsedApiObj = zCustomResourceIn.parse(apiObj);
  logger.log(`Event received for CRD ${CUSTOMRESOURCE_PLURAL}: ${phase}`);

  if (phase === "ADDED" || phase === "MODIFIED") {
    if (await validateCrHash(parsedApiObj)) {
      await reconcileResource(parsedApiObj);
    }
  }
  if (phase === "DELETED") {
    logger.log("Scheduling secrets cleanup job now");
    await scheduleSecretsCleanupJobNow();
  }
}

export async function updateStatus(
  k8sResourceName: string,
  status: z.input<typeof zCrdStatusOut>,
) {
  const resourceFetch = await k8sApiMC.getClusterCustomObject(
    CUSTOMRESOURCE_GROUP,
    CUSTOMRESOURCE_VERSION,
    CUSTOMRESOURCE_PLURAL,
    k8sResourceName,
  );
  const currentObj = zCustomResourceIn.parse(resourceFetch.body);
  const newStatus = zCrdStatusOut.parse({
    latestOperatorStatusUpdate: new Date().toISOString(),
    ...status,
  })

  const annotations = await generateCrAnnotations({ spec: currentObj.spec, status: newStatus })

  const crdUpdatedStatusPatch = {
    apiVersion: currentObj.apiVersion,
    kind: currentObj.kind,
    metadata: {
      name: currentObj.metadata.name,
      annotations: annotations
    },
    status: newStatus,
  };

  try {
    await k8sApiMC.patchClusterCustomObject(
      CUSTOMRESOURCE_GROUP,
      CUSTOMRESOURCE_VERSION,
      CUSTOMRESOURCE_PLURAL,
      k8sResourceName,
      crdUpdatedStatusPatch,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
      },
    );
  } catch (error) {
    logger.log("Failed to update cr status");
    throw error;
  }
}

export async function startWatching() {
  /* Watch client credentials custom resource */
  await watcher.watch(
    `/apis/${CUSTOMRESOURCE_GROUP}/${CUSTOMRESOURCE_VERSION}/${CUSTOMRESOURCE_PLURAL}`,
    {},
    onEvent,
    (err) => {
      logger.log(`Connection closed. ${err}`);
      process.exit(1);
    },
  );

  /* Watch managed secrets in order to act immediatly if one gets deteled or modified */
  // await watcher.watch(
  //     `/apis/v1/secrets`,
  //     {},
  //     (phase: string, apiObj: any) => {
  //         if (phase === 'DELETED' || phase === 'MODIFIED') {
  //             console.logger.log(apiObj)
  //         }
  //     },
  //     (err) => {
  //         logger.log(`Connection closed. ${err}`);
  //         process.exit(1);
  //     },
  // );
}
