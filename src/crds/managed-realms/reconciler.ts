import z from "npm:zod";
import { updateStatus } from "./handlers.ts";
import { zCustomResourceIn } from "./schemas.ts";
import { KeycloakClient } from "../../keycloak.ts";
import { Logger } from "../../util.ts";

const logger = new Logger("managed-realms reconciler");

const kcClient = new KeycloakClient();

export async function handleK8sResourceCreation(
  resourceName: string,
  objDetails: z.output<typeof zCustomResourceIn>,
) {
  logger.log(`Created resource: ${resourceName}`);
  await reconcileResource(resourceName, objDetails);
}

export async function handleK8sResourceDeletion(
  resourceName: string,
  objDetails: z.output<typeof zCustomResourceIn>,
) {
  if (!objDetails.spec.pruneRealm) {
    await kcClient.markRealmUnmanaged(objDetails.spec.realmId);
  }
  logger.log(`Deleted resource: ${resourceName}`);
  await cleanup();
}

export async function handleK8sResourceUpdate(
  resourceName: string,
  objDetails: z.output<typeof zCustomResourceIn>,
) {
  logger.log(`Updated resource: ${resourceName}`);
  await reconcileResource(resourceName, objDetails);
}

export async function reconcileResource(
  resourceName: string,
  objDetails: z.output<typeof zCustomResourceIn>,
) {
  const realmId = objDetails.spec.realmId;
  if (await kcClient.getRealmById(realmId) == null) {
    await kcClient.createRealm(realmId);
  }

  const actualClients = await kcClient.getRealmManagedClients(realmId);
  objDetails.spec.clients?.forEach(async (clientConfig) => {
    if (
      actualClients.find((actualClient) =>
        actualClient.id === clientConfig.id
      ) == null
    ) {
      await kcClient.createClient(realmId, {
        id: `${realmId}-${clientConfig.id}`,
        name: clientConfig.name,
        protocol: "openid-connect",
        clientId: clientConfig.id,
        publicClient: clientConfig.clientAuthenticationEnabled,
      });
    }
  });

  await updateStatus(resourceName, {
    "latestOperatorStatusUpdate": new Date().toISOString(),
  });
}

/** Perform any required deletions */
export async function cleanup() {
  const realms = await kcClient.getManagedRealms();
  const realmIds = realms.map((r) => r.realm).filter(Boolean) as string[];

  for (const realmId of realmIds) {
    logger.log(`Deleting realm with id ${realmId}`);
    await kcClient.deleteRealm(realmId);
  }
}
