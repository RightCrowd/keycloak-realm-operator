import { startWatching as startWatchingManagedRealms } from "./managed-realms/handlers.ts";
import { startWatching as startWatchingClientCredentials } from "./client-credentials/handlers.ts";

import {
  scheduleJobNow as scheduleSecretCleanupJobNow,
  scheduleJobs as scheduleSecretCleanupJobs,
} from "./client-credentials/secretsCleanupQueue.ts";
import {
  scheduleJobNow as _scheduleClientSecretsReconciliationNow,
  scheduleJobs as scheduleClientSecretsReconciliation,
} from "./client-credentials/reconciliationQueue.ts";

import {
  scheduleJobNow as scheduleRealmsCleanupJobNow,
  scheduleJobs as scheduleRealmsCleanupJobs,
} from "./managed-realms/cleanupQueue.ts";
import {
  scheduleJobNow as _scheduleRealmsReconciliationNow,
  scheduleJobs as scheduleRealmsReconciliation,
} from "./managed-realms/reconciliationQueue.ts";

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
    scheduleRealmsReconciliation(),
  ]);

  // Run the cleanups immediatly
  await Promise.all([
    scheduleSecretCleanupJobNow(),
    scheduleRealmsCleanupJobNow(),
  ]);
};
