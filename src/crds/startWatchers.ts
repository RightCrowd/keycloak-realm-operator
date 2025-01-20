import { startWatching as startWatchingManagedRealms } from "./realms/handlers.ts";
import { startWatching as startWatchingClientCredentials } from "./client-credentials/handlers.ts";

import {
  scheduleJobNow as scheduleRealmsCleanupJobNow,
  scheduleJobs as scheduleRealmsCleanupJobs,
} from "./realms/cleanupQueue.ts";
import {
  scheduleJobNow as _scheduleRealmsReconciliationNow,
  scheduleJobs as scheduleRealmsReconciliation,
} from "./realms/reconciliationQueue.ts";

import {
  scheduleJobNow as scheduleSecretCleanupJobNow,
  scheduleJobs as scheduleSecretCleanupJobs,
} from "./client-credentials/secretsCleanupQueue.ts";
import {
  scheduleJobNow as _scheduleClientSecretsReconciliationNow,
  scheduleJobs as scheduleClientSecretsReconciliation,
} from "./client-credentials/reconciliationQueue.ts";

import { genericCrds } from "./genericCrds/genericCrds.ts";
import { clientsCr } from "./clients/clientsCrd.ts";

export const startAllWatchers = async () => {
  await Promise.all([
    startWatchingManagedRealms(),
    startWatchingClientCredentials(),
    clientsCr.startWatching(),
    ...genericCrds.map((c) => c.startWatching()),
  ]);
};

export const startAllQueues = async () => {
  await Promise.all([
    scheduleSecretCleanupJobs(),
    scheduleClientSecretsReconciliation(),

    scheduleRealmsCleanupJobs(),
    scheduleRealmsReconciliation(),

    clientsCr.scheduleCleanupJobs(),
    clientsCr.scheduleReconciliationJobs(),

    ...genericCrds.map((c) => [
      c.scheduleCleanupJobs(),
      c.scheduleReconciliationJobs(),
    ]).flat(),
  ]);

  // Run the cleanups immediatly
  await Promise.all([
    scheduleSecretCleanupJobNow(),
    scheduleRealmsCleanupJobNow(),
    clientsCr.scheduleCleanupJobNow(),
    ...genericCrds.map((c) => c.scheduleCleanupJobNow()),
  ]);
};
