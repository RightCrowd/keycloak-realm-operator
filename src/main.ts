import { validateConfig } from "./config.ts";
import "./k8s.ts";
import {
  startAllQueues,
  startAllWatchers,
} from "./crds/_utils/startWatchers.ts";
import { Logger } from "./util.ts";
import { getConfig } from "./config.ts";

const logger = new Logger("main");

async function start() {
  logger.log("Validating configuration...");
  await validateConfig();

  if (getConfig().ENABLE_KUBERNETES_WATCHERS) {
    logger.log("Starting k8s watchers...");
    await startAllWatchers();
  }

  logger.log("Starting queues...");
  await startAllQueues();
}

start().catch((err) => {
  throw err;
});
