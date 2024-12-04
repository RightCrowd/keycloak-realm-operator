import { validateConfig } from './config.ts'
import './k8s.ts'
import { startWatching } from "./k8s.ts";
import { init as initReconciler, startReconciler } from "./reconciler.ts";
import { log } from './util.ts';

async function start() {
  log('Validating configuration...');
  await validateConfig();

  log('Initializing reconciler...');
  await initReconciler()

  log('Starting k8s watcher...');
  await startWatching()

  log('Starting reconciler loop...');
  await startReconciler()
};

start().catch((err) => { throw err });