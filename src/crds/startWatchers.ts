import { startWatching as startWatchingManagedRealms } from "./realms/handlers.ts";
import { startWatching as startWatchingManagedClients } from "./clients/handlers.ts";
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
  scheduleJobNow as scheduleClientsCleanupJobNow,
  scheduleJobs as scheduleClientsCleanupJobs,
} from "./clients/cleanupQueue.ts";
import {
  scheduleJobNow as _scheduleClientsReconciliationNow,
  scheduleJobs as scheduleClientsReconciliation,
} from "./clients/reconciliationQueue.ts";

import {
  scheduleJobNow as scheduleSecretCleanupJobNow,
  scheduleJobs as scheduleSecretCleanupJobs,
} from "./client-credentials/secretsCleanupQueue.ts";
import {
  scheduleJobNow as _scheduleClientSecretsReconciliationNow,
  scheduleJobs as scheduleClientSecretsReconciliation,
} from "./client-credentials/reconciliationQueue.ts";

export const startAllWatchers = async () => {
  await Promise.all([
    startWatchingManagedRealms(),
    startWatchingManagedClients(),
    startWatchingClientCredentials(),
  ]);
};

export const startAllQueues = async () => {
  await Promise.all([
    scheduleSecretCleanupJobs(),
    scheduleClientSecretsReconciliation(),

    scheduleRealmsCleanupJobs(),
    scheduleRealmsReconciliation(),

    scheduleClientsCleanupJobs(),
    scheduleClientsReconciliation(),
  ]);

  // Run the cleanups immediatly
  await Promise.all([
    scheduleSecretCleanupJobNow(),
    scheduleRealmsCleanupJobNow(),
    scheduleClientsCleanupJobNow(),
  ]);
};
