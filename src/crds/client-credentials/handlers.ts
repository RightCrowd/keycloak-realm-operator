import z from "npm:zod";
import { watcher } from "../../k8s.ts";
import { Logger } from "../../util.ts";
import {
  CUSTOMRESOURCE_GROUP,
  CUSTOMRESOURCE_PLURAL,
  CUSTOMRESOURCE_VERSION,
  makeSelector,
  zCustomResourceIn,
  zCustomResourceOut,
} from "./schemas.ts";
import { reconcileResource } from "./reconciler.ts";
import { scheduleJobNow as scheduleSecretsCleanupJobNow } from "./secretsCleanupQueue.ts";
import {
  updateCr as updateCrGeneric,
  validateCrHash,
  zBasicCr,
} from "../crd-mgmt-utils.ts";

const logger = new Logger("client-credentials crd handler");

// Zod parse to make sure defaults are applied
export const updateCr: typeof updateCrGeneric<
  z.input<typeof zCustomResourceOut>
> = (selector, updates) => {
  return updateCrGeneric(selector, updates);
};

async function onEvent(
  _phase: string,
  apiObj: object,
) {
  const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
  const parsedApiObj = zCustomResourceIn.parse(apiObj);

  const selector = makeSelector(
    parsedApiObj.metadata.namespace,
    parsedApiObj.metadata.name,
  );
  logger.log(
    `Event received for CRD ${CUSTOMRESOURCE_PLURAL}: ${phase}`,
    selector,
  );

  // Set initial state
  if (parsedApiObj.status?.state == null) {
    await updateCr(selector, { status: { state: "not-synced" } });
  }

  if (
    (phase === "ADDED" || phase === "MODIFIED") &&
    !(await validateCrHash(zBasicCr.parse(apiObj)))
  ) {
    try {
      await reconcileResource(parsedApiObj, selector);
    } catch (error) {
      logger.error("Error reconciling resource", {
        selector,
        error,
      });
      await updateCr(selector, { status: { state: "failed" } });
    }
  }

  if (phase === "DELETED") {
    logger.log("Scheduling secrets cleanup job now");
    await scheduleSecretsCleanupJobNow();
  }
}

export async function startWatching() {
  /* Watch client credentials custom resource */
  await watcher.watch(
    `/apis/${CUSTOMRESOURCE_GROUP}/${CUSTOMRESOURCE_VERSION}/${CUSTOMRESOURCE_PLURAL}`,
    {},
    onEvent,
    async (err) => {
      logger.log("Connection closed", err);
      logger.info("Restarting watcher");
      await startWatching();
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
