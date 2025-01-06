import z from "npm:zod";
import { k8sApiMC, watcher } from "../../k8s.ts";
import { Logger } from "../../util.ts";
import {
  CUSTOMRESOURCE_GROUP,
  CUSTOMRESOURCE_PLURAL,
  CUSTOMRESOURCE_VERSION,
  zCrdStatusIn,
  zCrdStatusOut,
  zCustomResourceIn,
} from "./schemas.ts";
import process from "node:process";
import {
  handleK8sResourceCreation,
  handleK8sResourceDeletion,
  handleK8sResourceUpdate,
} from "./reconciler.ts";

const logger = new Logger("managed-realms crd handler");

async function onEvent(
  _phase: string,
  apiObj: z.output<typeof zCustomResourceIn>,
) {
  const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
  logger.log(`Event received for CRD ${CUSTOMRESOURCE_PLURAL}: ${phase}`);

  const status = zCrdStatusIn.parse(apiObj.status);
  if (phase == "ADDED") {
    await handleK8sResourceCreation(apiObj.metadata.name, apiObj);
  } else if (phase == "MODIFIED") {
    // TODO: we can probably do something more clever ⬇️
    // If the operator updated the resource less than 500ms ago, the incoming update might simply be our own update. Let's ignore it
    if (
      status?.latestOperatorStatusUpdate != null &&
      ((new Date().getTime() -
        new Date(status.latestOperatorStatusUpdate).getTime()) < 500)
    ) {
      logger.log(`Ignoring own update`);
      return;
    }
    await handleK8sResourceUpdate(apiObj.metadata.name, apiObj);
  } else if (phase == "DELETED") {
    await handleK8sResourceDeletion(apiObj.metadata.name!, apiObj);
  } else {
    logger.log(`Unknown event type: ${phase}`);
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
      latestOperatorStatusUpdate: new Date().toISOString(),
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
    logger.log("Failed to update cr status");
    throw error;
  }
}

export async function startWatching() {
  await watcher.watch(
    `/apis/${CUSTOMRESOURCE_GROUP}/${CUSTOMRESOURCE_VERSION}/${CUSTOMRESOURCE_PLURAL}`,
    {},
    onEvent,
    (err) => {
      logger.log(`Connection closed. ${err}`);
      process.exit(1);
    },
  );
}
