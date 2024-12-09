import { validateConfig } from "./config.ts";
import "./k8s.ts";
import { startAllQueues, startAllWatchers } from "./crds/startWatchers.ts";
import { log } from "./util.ts";

async function start() {
  log("Validating configuration...");
  await validateConfig();

  // log('Initializing reconciler...');
  // await initReconciler()

  log("Starting k8s watchers...");
  await startAllWatchers();

  log("Starting queues...");
  await startAllQueues();

  // log('Starting reconciler loop...');
  // await startReconciler()
}

start().catch((err) => {
  throw err;
});
