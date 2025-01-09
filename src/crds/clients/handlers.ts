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
import {
  updateCr as updateCrGeneric,
  validateCrHash,
  zBasicCr,
} from "../crd-mgmt-utils.ts";
import { addReconciliationJob } from "./reconciliationQueue.ts";
import { scheduleJobNow as promoteCleanupJob } from "./cleanupQueue.ts";

const logger = new Logger("managed-clients crd handler");

export const updateCr = updateCrGeneric<z.input<typeof zCustomResourceOut>>;

async function onEvent(
  _phase: string,
  apiObj: object,
) {
  const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
  const parsedApiObj = zCustomResourceIn.parse(apiObj);

  const selector = makeSelector(parsedApiObj.metadata.name);
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
    await addReconciliationJob({
      instances: [{
        apiObj: parsedApiObj,
        selector,
      }],
    });
  }

  if (phase === "DELETED") {
    await promoteCleanupJob();
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
}
