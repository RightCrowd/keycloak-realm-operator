import z from "npm:zod";
import { k8sApiMC, watcher } from "../../k8s.ts";
import { log } from "../../util.ts";
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

async function onEvent(
  _phase: string,
  apiObj: object,
) {
  const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
  const parsedApiObj = zCustomResourceIn.parse(apiObj);
  log(`Event received for CRD ${CUSTOMRESOURCE_PLURAL}: ${phase}`);

  if (phase === "ADDED" || phase === "MODIFIED") {
    await reconcileResource(parsedApiObj);
  }
  if (phase === "DELETED") {
    log("Scheduling secrets cleanup job now");
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

  const crdUpdatedStatusPatch = {
    apiVersion: currentObj.apiVersion,
    kind: currentObj.kind,
    metadata: {
      name: currentObj.metadata.name,
    },
    status: zCrdStatusOut.parse({
      lastOperatorStatusUpdate: new Date().toISOString(),
      ...status,
    }),
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
    log("Failed to update cr status");
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
      log(`Connection closed. ${err}`);
      process.exit(1);
    },
  );

  /* Watch managed secrets in order to act immediatly if one gets deteled or modified */
  // await watcher.watch(
  //     `/apis/v1/secrets`,
  //     {},
  //     (phase: string, apiObj: any) => {
  //         if (phase === 'DELETED' || phase === 'MODIFIED') {
  //             console.log(apiObj)
  //         }
  //     },
  //     (err) => {
  //         log(`Connection closed. ${err}`);
  //         process.exit(1);
  //     },
  // );
}
