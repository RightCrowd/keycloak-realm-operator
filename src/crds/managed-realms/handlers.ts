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
import process from "node:process";
import { reconcileResource } from "./reconciler.ts";
import { scheduleJobNow as scheduleSecretsCleanupJobNow } from "./secretsCleanupQueue.ts";
import {
  updateCr as updateCrGeneric,
  validateCrHash,
} from "../crd-mgmt-utils.ts";

const logger = new Logger("managed-realms crd handler");

export const updateCr = updateCrGeneric<z.input<typeof zCustomResourceOut>>;

async function onEvent(
  _phase: string,
  apiObj: object,
) {
  const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
  const parsedApiObj = zCustomResourceIn.parse(apiObj);
  logger.log(`Event received for CRD ${CUSTOMRESOURCE_PLURAL}: ${phase}`);

  const selector = makeSelector(parsedApiObj.metadata.name);

  if (phase === "ADDED" || phase === "MODIFIED") {
    if (!(await validateCrHash(parsedApiObj))) {
      if (parsedApiObj.status?.state == null) {
        await updateCr(selector, { status: { state: "not-synced" } });
      }
      await reconcileResource(parsedApiObj);
    }
  }
  if (phase === "DELETED") {
    logger.log("Scheduling managed-realms cleanup job now");
    await scheduleSecretsCleanupJobNow();
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
}
