import z from "npm:zod";
import { updateStatus, zCustomResourceIn } from "./k8s.ts";
import { KeycloakClient } from "./keycloak.ts";
import { log } from './util.ts';

const kcClient = new KeycloakClient()

export async function init () {
}

export async function handleK8sResourceCreation(resourceName: string, objDetails: z.output<typeof zCustomResourceIn>) {
    console.log(`Created resource: ${resourceName}`);
    await reconcileResource(resourceName, objDetails)
}

export async function handleK8sResourceDeletion(resourceName: string, objDetails: z.output<typeof zCustomResourceIn>) {
    if (!objDetails.spec.pruneRealm) {
        await kcClient.markRealmUnmanaged(objDetails.spec.realmId)
    }
    console.log(`Deleted resource: ${resourceName}`);
    await cleanup();
}

export async function handleK8sResourceUpdate(resourceName: string, objDetails: z.output<typeof zCustomResourceIn>) {
    console.log(`Updated resource: ${resourceName}`);
    await reconcileResource(resourceName, objDetails)
}

export async function reconcileResource (resourceName: string, objDetails: z.output<typeof zCustomResourceIn>) {
    if (await kcClient.getRealmById(objDetails.spec.realmId) == null) {
        await kcClient.createRealm(objDetails.spec.realmId)
    }

    await updateStatus(resourceName, {
        'lastOperatorStatusUpdate': new Date().toISOString()
    })
}

export async function startReconciler() {
}

/** Perform any required deletions */
export async function cleanup() {
    const realms = await kcClient.getManagedRealms()
    const realmIds = realms.map(r => r.realm).filter(Boolean) as string[]

    for (const realmId of realmIds) {
        log(`Deleting realm with id ${realmId}`)
        await kcClient.deleteRealm(realmId);
    }
}