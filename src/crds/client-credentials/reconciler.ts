import {
  CUSTOMRESOURCE_GROUP,
  CUSTOMRESOURCE_PLURAL,
  CUSTOMRESOURCE_VERSION,
  type CustomResourceIn,
  type CustomResourceOut,
  makeSelector,
  zCustomResourceIn,
} from "./schemas.ts";
import { k8sApiMC, k8sApiPods } from "../../k8s.ts";
import { V1Secret } from "npm:@kubernetes/client-node";
import { type ClientRepresentation, KeycloakClient } from "../../keycloak.ts";
import { Logger } from "../../util.ts";
import { parse } from "npm:@ctrl/golang-template";
import { type CrSelector, logCrEvent } from "../crd-mgmt-utils.ts";
import { updateCr } from "./handlers.ts";

const logger = new Logger("client-credentials reconciler");

const kcClient = new KeycloakClient();

const sourceAnnotationKey =
  `${CUSTOMRESOURCE_GROUP}/keycloak-realm-operator-source`;

const generateEncodedSecretData =
  (targetSecretTemplate?: { key: string; template: string }[]) =>
  (realm: string, clientId: string, clientSecret: string) => {
    type K8sSecretData = { [key: string]: string };
    const k8sSecretData =
      targetSecretTemplate?.reduce((acc: K8sSecretData, template) => {
        acc[template.key] = parse(template.template, {
          clientId,
          clientSecret,
          realm,
        });
        return acc;
      }, {} as K8sSecretData) ?? {
        clientId,
        clientSecret,
        realm,
      };

    const encodedK8sSecretData = Object.entries(k8sSecretData).reduce(
      (acc: K8sSecretData, [key, value]) => {
        acc[key] = btoa(value);
        return acc;
      },
      {} as K8sSecretData,
    );

    return encodedK8sSecretData;
  };

export const reconcileResource = async (
  apiObj: CustomResourceIn,
  selector: CrSelector,
) => {
  logger.log(
    `Reconciling CR`,
    selector,
  );
  await updateCr(selector, { status: { state: "syncing" } });
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
      console.error(_err);
      // Client does not exist
      await logCrEvent(selector, apiObj.metadata.uid, {
        message:
          `Client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} is not found`,
        type: "Warning",
        reason: "Failed",
      });
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
      logger.log(
        `Secret ${apiObj.spec.targetSecretName} in namespace ${apiObj.metadata.namespace} exists but is not owned by operator`,
      );
      await updateCr(selector, { status: { state: "failed" } });
      return;
    }

    // Secret exists and is owned by this operator
    // Update the secret with the new data
    const targettedKcClient = await getKcClient();
    const clientId = targettedKcClient?.clientId;
    const clientSecret = targettedKcClient?.secret;

    if (clientId == null || clientSecret == null) {
      await updateCr(selector, { status: { state: "failed" } });
      await logCrEvent(selector, apiObj.metadata.uid, {
        message:
          `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not posess id or secret, or client does not exist`,
        type: "Warning",
        reason: "Failed",
      });
      if (apiObj.spec.fallbackStrategy === "skip") {
        logger.log(
          `Keycloak credentials not found for ${apiObj.metadata.name} in namespace ${apiObj.metadata.namespace}. FallbackStrategy is 'skip', so skipping.`,
        );
        return;
      }
      throw new Error(
        `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not posess id or secret, or client does not exist`,
      );
    }

    await logCrEvent(selector, apiObj.metadata.uid, {
      message:
        `Updating secret ${apiObj.spec.targetSecretName} in namespace ${apiObj.metadata.namespace}`,
      reason: "Syncing",
    });
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
        data: generateEncodedSecretData(apiObj.spec.targetSecretTemplate)(
          apiObj.spec.realm,
          clientId,
          clientSecret,
        ),
      },
    );
    await updateCr(selector, { status: { state: "synced" } });
    return;
  }

  // Secret does not exist yet
  const targettedKcClient = await getKcClient();
  const clientId = targettedKcClient?.clientId;
  const clientSecret = targettedKcClient?.secret;
  if (clientId == null || clientSecret == null) {
    await updateCr(selector, { status: { state: "failed" } });
    if (apiObj.spec.fallbackStrategy === "skip") {
      logger.log(
        `Keycloak credentials not found for ${apiObj.metadata.name} in namespace ${apiObj.metadata.namespace}. FallbackStrategy is 'skip', so skipping.`,
      );
      return;
    }
    throw new Error(
      `KC client ${apiObj.spec.clientId} in realm ${apiObj.spec.realm} does not posess id or secret, or client does not exist`,
    );
  }

  await logCrEvent(selector, apiObj.metadata.uid, {
    message:
      `Creating secret ${apiObj.spec.targetSecretName} in namespace ${apiObj.metadata.namespace}`,
    reason: "Syncing",
  });
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
    data: generateEncodedSecretData(apiObj.spec.targetSecretTemplate)(
      apiObj.spec.realm,
      clientId,
      clientSecret,
    ),
  });
  await updateCr(selector, { status: { state: "synced" } });
};

export const reconcileAllResources = async () => {
  const namespaces = (await k8sApiPods.listNamespace()).body.items;
  for (const namespace of namespaces) {
    if (namespace.metadata?.name != null) {
      const ns = namespace.metadata.name;
      const crs = ((await k8sApiMC.listNamespacedCustomObject(
        CUSTOMRESOURCE_GROUP,
        CUSTOMRESOURCE_VERSION,
        ns,
        CUSTOMRESOURCE_PLURAL,
      )).body as { items: CustomResourceIn[] }).items;
      const crsAndSelectors = crs.map((cr) => ({
        cr,
        selector: makeSelector(ns, cr.metadata.name),
      }));

      for (const crAndSelector of crsAndSelectors) {
        await reconcileResource(
          zCustomResourceIn.parse(crAndSelector.cr),
          crAndSelector.selector,
        );
      }
    }
  }
};

export const cleanup = async () => {
  const namespaces = (await k8sApiPods.listNamespace()).body.items;
  const secrets: V1Secret[] = [];
  const customResources: CustomResourceOut[] = [];
  for (const namespace of namespaces) {
    if (namespace.metadata?.name != null) {
      const ns = namespace.metadata.name;
      secrets.push(...(await k8sApiPods.listNamespacedSecret(ns)).body.items);
      customResources.push(
        ...((await k8sApiMC.listNamespacedCustomObject(
          CUSTOMRESOURCE_GROUP,
          CUSTOMRESOURCE_VERSION,
          ns,
          CUSTOMRESOURCE_PLURAL,
        )).body as { items: CustomResourceOut[] }).items,
      );
    }
  }
  const managedSecrets = secrets.filter((s) =>
    s.metadata?.annotations?.[sourceAnnotationKey] != null
  );

  const lingeringManagedSecrets = managedSecrets.filter((s) => {
    if (s.metadata?.name == null || s.metadata?.namespace == null) {
      return true;
    }
    const matchExists = customResources.some((cr) =>
      cr.spec.targetSecretName === s.metadata!.name! &&
      cr.metadata.namespace === s.metadata!.namespace!
    );
    return !matchExists;
  });

  for (const secret of lingeringManagedSecrets) {
    await k8sApiPods.deleteNamespacedSecret(
      secret.metadata!.name!,
      secret.metadata!.namespace!,
    );
  }
};
