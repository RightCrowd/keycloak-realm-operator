import { CUSTOMRESOURCE_GROUP, CustomResourceIn } from "./schemas.ts";
import { k8sApiPods } from "../../k8s.ts";
import { V1Secret } from "npm:@kubernetes/client-node";
import { type ClientRepresentation, KeycloakClient } from "../../keycloak.ts";
import { log } from "../../util.ts";

const kcClient = new KeycloakClient();

const sourceAnnotationKey =
    `${CUSTOMRESOURCE_GROUP}/keycloak-realm-operator-source`;

export const reconcileResource = async (apiObj: CustomResourceIn) => {
    let currentSecret: V1Secret | undefined;
    try {
        currentSecret = (await k8sApiPods.readNamespacedSecret(
            apiObj.spec.targetSecretName,
            apiObj.metadata.namespace,
        )).body;
    } catch (error) {
        // Secret does not exist yet
        log(String(error))
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
        if (targettedKcClient == null) {
            // TODO: Do something in case the KC client does not exist
            throw new Error(
                `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not exist`,
            );
        }
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
        const { clientId, secret: clientSecret } = targettedKcClient;
        if (clientId == null || clientSecret == null) {
            // TODO: Do something in case the KC client does not have a clientId or secret
            throw new Error(
                `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not posess id or secret`,
            );
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
