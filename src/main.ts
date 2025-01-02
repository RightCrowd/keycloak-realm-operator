import { validateConfig } from "./config.ts";
import "./k8s.ts";
import { startAllQueues, startAllWatchers } from "./crds/startWatchers.ts";
import { Logger } from "./util.ts";

const logger = new Logger("main");

async function start() {
  logger.log("Validating configuration...");
  await validateConfig();

  // logger.log('Initializing reconciler...');
  // await initReconciler()

  logger.log("Starting k8s watchers...");
  await startAllWatchers();

  logger.log("Starting queues...");
  await startAllQueues();

  // logger.log('Starting reconciler loop...');
  // await startReconciler()
}

start().catch((err) => {
  throw err;
});
