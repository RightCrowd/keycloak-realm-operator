import { CUSTOMRESOURCE_GROUP, type CustomResourceIn, type CustomResourceOut, CUSTOMRESOURCE_VERSION, CUSTOMRESOURCE_PLURAL, zCustomResourceIn } from "./schemas.ts";
import { k8sApiPods, k8sApiMC } from "../../k8s.ts";
import { V1Secret } from "npm:@kubernetes/client-node";
import { type ClientRepresentation, KeycloakClient } from "../../keycloak.ts";
import { log } from "../../util.ts";

const kcClient = new KeycloakClient();

const sourceAnnotationKey =
    `${CUSTOMRESOURCE_GROUP}/keycloak-realm-operator-source`;

export const reconcileResource = async (apiObj: CustomResourceIn) => {
    log(`Reconciling CR of type ${CUSTOMRESOURCE_PLURAL}, name "${apiObj.metadata.name}" in namespace "${apiObj.metadata.namespace}"`)
    let currentSecret: V1Secret | undefined;
    try {
        currentSecret = (await k8sApiPods.readNamespacedSecret(
            apiObj.spec.targetSecretName,
            apiObj.metadata.namespace,
        )).body;
    } catch (_error) {
        // Secret does not exist yet
    }

    const getKcClient = async () => {
        let targettedKcClient: ClientRepresentation | undefined;
        try {
            targettedKcClient = await kcClient.getRealmClientByClientIdOrThrow(
                apiObj.spec.realm,
                apiObj.spec.clientId,
            );
        } catch (_err) {
            console.error(_err)
            // Client does not exist
        }
        // if (targettedKcClient == null) {
        //     // TODO: Do something in case the KC client does not exist
        //     throw new Error(
        //         `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not exist`,
        //     );
        // }
        return targettedKcClient;
    };

    if (currentSecret != null) {
        if (
            currentSecret.metadata?.annotations?.[sourceAnnotationKey] !==
                apiObj.metadata.name
        ) {
            // Secret exists but is not owned by this operator
            // TODO: Think up some way to handle this. We simply do nothing for now
            log(`Secret ${apiObj.spec.targetSecretName} in namespace ${apiObj.metadata.namespace} exists but is not owned by operator`);
            return;
        }

        // Secret exists and is owned by this operator
        // Update the secret with the new data
        const targettedKcClient = await getKcClient();
        const clientId = targettedKcClient?.clientId;
        const clientSecret = targettedKcClient?.secret;
        if (clientId == null || clientSecret == null) {
            if (apiObj.spec.fallbackStrategy === 'skip') {
                log(`Keycloak credentials not found for ${apiObj.metadata.name} in namespace ${apiObj.metadata.namespace}. FallbackStrategy is 'skip', so skipping.`)
                return;
            }
            if (apiObj.spec.fallbackStrategy === 'error') {
                throw new Error(
                    `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not posess id or secret, or client does not exist`,
                );
            }
        }

        await k8sApiPods.replaceNamespacedSecret(
            apiObj.spec.targetSecretName,
            apiObj.metadata.namespace,
            {
                apiVersion: "v1",
                kind: "Secret",
                metadata: {
                    name: apiObj.spec.targetSecretName,
                    annotations: {
                        [sourceAnnotationKey]: apiObj.metadata.name,
                    },
                },
                type: "Opaque",
                data: {
                    [apiObj.spec.keys.clientIdProperty]: btoa(clientId),
                    [apiObj.spec.keys.clientSecretProperty]: btoa(clientSecret),
                    [apiObj.spec.keys.realmProperty]: btoa(apiObj.spec.realm),
                },
            },
        );
        return;
    }

    // Secret does not exist yet
    const targettedKcClient = await getKcClient();
    const { clientId, secret: clientSecret } = targettedKcClient;
    if (clientId == null || clientSecret == null) {
        // TODO: Do something in case the KC client does not have a clientId or secret
        throw new Error(
            `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not posess id or secret`,
        );
    }

    await k8sApiPods.createNamespacedSecret(apiObj.metadata.namespace, {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
            name: apiObj.spec.targetSecretName,
            annotations: {
                [sourceAnnotationKey]: apiObj.metadata.name,
            },
        },
        type: "Opaque",
        data: {
            [apiObj.spec.keys.clientIdProperty]: btoa(clientId),
            [apiObj.spec.keys.clientSecretProperty]: btoa(clientSecret),
            [apiObj.spec.keys.realmProperty]: btoa(apiObj.spec.realm),
        },
    });
};

export const reconcileAllResources = async () => {
    const namespaces = (await k8sApiPods.listNamespace()).body.items
    const customResources: CustomResourceOut[] = []
    for (const namespace of namespaces) {
        if (namespace.metadata?.name != null) {
            const ns = namespace.metadata.name
            customResources.push(...((await k8sApiMC.listNamespacedCustomObject(CUSTOMRESOURCE_GROUP, CUSTOMRESOURCE_VERSION, ns, CUSTOMRESOURCE_PLURAL)).body as {items: CustomResourceOut[]}).items)
        }
    }
    await Promise.all(customResources.map(cr => reconcileResource(zCustomResourceIn.parse(cr))))
}

export const cleanup = async () => {
    const namespaces = (await k8sApiPods.listNamespace()).body.items
    const secrets: V1Secret[] = []
    const customResources: CustomResourceOut[] = []
    for (const namespace of namespaces) {
        if (namespace.metadata?.name != null) {
            const ns = namespace.metadata.name
            secrets.push(...(await k8sApiPods.listNamespacedSecret(ns)).body.items)
            customResources.push(...((await k8sApiMC.listNamespacedCustomObject(CUSTOMRESOURCE_GROUP, CUSTOMRESOURCE_VERSION, ns, CUSTOMRESOURCE_PLURAL)).body as {items: CustomResourceOut[]}).items)
        }
    }
    const managedSecrets = secrets.filter(s => s.metadata?.annotations?.[sourceAnnotationKey] != null)

    const lingeringManagedSecrets = managedSecrets.filter(s => {
        if (s.metadata?.name == null || s.metadata?.namespace == null) {
            return true
        }
        const matchExists = customResources.some(cr => cr.spec.targetSecretName === s.metadata!.name! && cr.metadata.namespace === s.metadata!.namespace!)
        return !matchExists
    })

    for (const secret of lingeringManagedSecrets) {
        await k8sApiPods.deleteNamespacedSecret(secret.metadata!.name!, secret.metadata!.namespace!)
    }
}