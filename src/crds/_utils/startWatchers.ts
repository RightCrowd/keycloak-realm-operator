import { startWatching as startWatchingManagedRealms } from "../realms/handlers.ts";
import { startWatching as startWatchingClientCredentials } from "../client-credentials/handlers.ts";

import {
  scheduleJobNow as scheduleRealmsCleanupJobNow,
  scheduleJobs as scheduleRealmsCleanupJobs,
} from "../realms/cleanupQueue.ts";
import {
  scheduleJobNow as _scheduleRealmsReconciliationNow,
  scheduleJobs as scheduleRealmsReconciliation,
} from "../realms/reconciliationQueue.ts";

import {
  scheduleJobNow as scheduleSecretCleanupJobNow,
  scheduleJobs as scheduleSecretCleanupJobs,
} from "../client-credentials/secretsCleanupQueue.ts";
import {
  scheduleJobNow as _scheduleClientSecretsReconciliationNow,
  scheduleJobs as scheduleClientSecretsReconciliation,
} from "../client-credentials/reconciliationQueue.ts";

import { clientScopesCr } from "../client-scopes.cr.ts";
import { clientsCr } from "../clients.cr.ts";
import { groupsCr } from "../groups.cr.ts";
import { usersCr } from "../users.cr.ts";

export const startAllWatchers = async () => {
  await Promise.all([
    startWatchingManagedRealms(),
    startWatchingClientCredentials(),
    clientsCr.startWatching(),
    clientScopesCr.startWatching(),
    groupsCr.startWatching(),
    usersCr.startWatching(),
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

    clientScopesCr.scheduleCleanupJobs(),
    clientScopesCr.scheduleReconciliationJobs(),

    groupsCr.scheduleCleanupJobs(),
    groupsCr.scheduleReconciliationJobs(),

    usersCr.scheduleCleanupJobs(),
    usersCr.scheduleReconciliationJobs(),
  ]);

  // Run the cleanups immediatly
  await Promise.all([
    scheduleSecretCleanupJobNow(),
    scheduleRealmsCleanupJobNow(),
    clientsCr.scheduleCleanupJobNow(),
    clientScopesCr.scheduleCleanupJobNow(),
    groupsCr.scheduleCleanupJobNow(),
    usersCr.scheduleCleanupJobNow(),
  ]);
};
