import { startWatching as startWatchingManagedRealms } from "./managed-realms/handlers.ts";
import { startWatching as startWatchingClientCredentials } from "./client-credentials/handlers.ts";

import { scheduleJobs as scheduleSecretCleanupJobs, scheduleJobNow as scheduleSecretCleanupJobNow } from "./client-credentials/secretsCleanupQueue.ts";
import { scheduleJobs as scheduleClientSecretsReconciliation, scheduleJobNow as _scheduleClientSecretsReconciliationNow } from "./client-credentials/reconciliationQueue.ts";

import { scheduleJobs as scheduleRealmsCleanupJobs, scheduleJobNow as scheduleRealmsCleanupJobNow } from ".//managed-realms/cleanupQueue.ts";
import { scheduleJobs as scheduleRealmsReconciliation, scheduleJobNow as _scheduleRealmsReconciliationNow } from "./managed-realms/reconciliationQueue.ts";

export const startAllWatchers = async () => {
  await Promise.all([
    startWatchingManagedRealms(),
    startWatchingClientCredentials(),
  ]);
};

export const startAllQueues = async () => {
  await Promise.all([
    scheduleSecretCleanupJobs(),
    scheduleClientSecretsReconciliation(),

    scheduleRealmsCleanupJobs(),
    scheduleRealmsReconciliation()
  ]);

  // Run the cleanups immediatly
  await Promise.all([
    scheduleSecretCleanupJobNow(),
    scheduleRealmsCleanupJobNow(),
  ])
};
