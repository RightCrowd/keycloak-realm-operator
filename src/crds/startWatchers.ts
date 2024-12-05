import { startWatching as startWatchingManagedRealms } from "./managed-realms/handlers.ts"
import { startWatching as startWatchingClientCredentials } from "./client-credentials/handlers.ts"

export const startAllWatchers = async () => {
    await Promise.all([
        startWatchingManagedRealms(),
        startWatchingClientCredentials(),
    ])
}