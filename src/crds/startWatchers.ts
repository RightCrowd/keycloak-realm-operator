// import { startWatching as startWatchingManagedRealms } from "./managed-realms/handlers.ts";
import { startWatching as startWatchingClientCredentials } from "./client-credentials/handlers.ts";

import { scheduleJobs as scheduleSecretCleanupJobs } from "./client-credentials/secretsCleanupQueue.ts";
import { scheduleJobs as scheduleClientSecretsReconciliation } from "./client-credentials/reconciliationQueue.ts";

export const startAllWatchers = async () => {
  await Promise.all([
    // TODO: RealmManagement isn't really working rn so disabled it. We should fix it :)
    // startWatchingManagedRealms(),
    startWatchingClientCredentials(),
  ]);
};

export const startAllQueues = async () => {
  await Promise.all([
    scheduleSecretCleanupJobs(),
    scheduleClientSecretsReconciliation(),
  ]);
};
