import {
  CUSTOMRESOURCE_GROUP,
  CUSTOMRESOURCE_PLURAL,
  CUSTOMRESOURCE_VERSION,
  type CustomResourceIn,
  makeSelector,
  zCrdSpec,
  zCustomResourceIn,
} from "./schemas.ts";
import { k8sApiMC } from "../../k8s.ts";
import { KeycloakClient } from "../../keycloak.ts";
import { Logger } from "../../util.ts";
import { type CrSelector } from "../crd-mgmt-utils.ts";
import { updateCr } from "./handlers.ts";
import type { ClientRepresentation } from "../../keycloak.ts";
import { k8sApiPods } from "../../k8s.ts";

const logger = new Logger("managed-client reconciler");

const kcClient = new KeycloakClient();

const claimAttributes = {
  "k8s.rightcrowd.com/keycloak-realm-operator/claim": "true",
} satisfies Record<string, string>;

const crSpecRealmAttribute =
  "k8s.rightcrowd.com/keycloak-realm-operator/cr-spec-serialized";

const isClaimed = (
  client: { attributes?: ClientRepresentation["attributes"] },
) => {
  const attributes = client.attributes ?? {};
  const expectedAttributes = claimAttributes as Record<string, string>;
  const differ = Object.keys(expectedAttributes).some((expectedKey: string) =>
    attributes[expectedKey] !== expectedAttributes[expectedKey]
  );
  return !differ;
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

  const { spec } = apiObj;
  const { realmId: realm, clientId: id } = spec;

  // Make sure the realm exists
  await kcClient.ensureAuthed();
  if ((await kcClient.client.realms.findOne({ realm })) == null) {
    logger.error(`Realm not found ${realm}`);
    await updateCr(selector, { status: { state: "failed" } });
    return;
  }

  await kcClient.ensureAuthed();
  let currentKcClient = await kcClient.client.clients.findOne({
    realm,
    id,
  });

  if (currentKcClient == null) {
    // The client does not exist yet. Let's create it
    logger.log(`Creating and claiming Keycloak client ${id} in realm ${realm}`);
    await kcClient.ensureAuthed();
    await kcClient.client.clients.create({
      realm,
      id,
      clientId: id,
      name: spec.name,
      attributes: {
        ...claimAttributes,
        [crSpecRealmAttribute]: JSON.stringify(spec),
      },
    });
    await kcClient.ensureAuthed();
    currentKcClient = (await kcClient.client.clients.findOne({
      realm,
      id,
    }))!;
  }

  let claimed = isClaimed(currentKcClient);
  if (!claimed) {
    logger.log(`Client ${id} is unclaimed in realm ${realm}`);
    if (spec.claimClient) {
      logger.log(`Claiming client ${id} in realm ${realm}`);
      await kcClient.ensureAuthed();
      await kcClient.client.clients.update({ realm, id }, {
        attributes: {
          ...currentKcClient.attributes,
          ...claimAttributes,
          [crSpecRealmAttribute]: JSON.stringify(spec),
        },
      });
      claimed = true;
    }
  }

  if (!claimed) {
    logger.error(
      `Client ${id} in realm ${realm} is not claimed and claiming is disabled`,
    );
    await updateCr(selector, { status: { state: "failed" } });
    return;
  }

  let secret: string | undefined;
  if (spec.secret != null) {
    if ("value" in spec.secret) {
      secret = spec.secret.value;
    } else {
      const { namespace, name, key } = spec.secret.valueFrom.secretKeyRef;
      const k8sSecretData =
        (await k8sApiPods.readNamespacedSecret(name, namespace)).body;
      const encodedSecretValue = k8sSecretData.data?.[key];
      if (encodedSecretValue != null) {
        secret = atob(encodedSecretValue);
      }
    }
  }

  if (spec.representation != null) {
    await kcClient.ensureAuthed();
    logger.log(`Performing update for client ${id} in realm ${realm}`);
    kcClient.client.clients.update({ realm, id }, {
      ...spec.representation,
      secret,
      id: undefined,
      clientId: undefined,
    });
  }

  await updateCr(selector, { status: { state: "synced" } });
};

export const reconcileAllResources = async () => {
  const crs = ((await k8sApiMC.listClusterCustomObject(
    CUSTOMRESOURCE_GROUP,
    CUSTOMRESOURCE_VERSION,
    CUSTOMRESOURCE_PLURAL,
  )).body as { items: CustomResourceIn[] }).items;
  const crsAndSelectors = crs.map((cr) => ({
    cr,
    selector: makeSelector(cr.metadata.name),
  }));

  for (const crAndSelector of crsAndSelectors) {
    await reconcileResource(
      zCustomResourceIn.parse(crAndSelector.cr),
      crAndSelector.selector,
    );
  }
};

export const cleanup = async () => {
  await kcClient.ensureAuthed();
  const clients = await kcClient.client.clients.find();
  const realmAmededClients = clients.map((c) => {
    if (c.clientId == null) {
      throw new Error(`clientId not defined`);
    }
    return {
      ...c,
      clientId: c.clientId,
      realm: c.baseUrl?.match(/\/realms\/(?<realm>.+?)\//)?.groups?.realm,
    };
  });
  const crs = (await k8sApiMC.listClusterCustomObject(
    CUSTOMRESOURCE_GROUP,
    CUSTOMRESOURCE_VERSION,
    CUSTOMRESOURCE_PLURAL,
  )).body as {
    items: CustomResourceIn[];
  };
  const crManagedClients = crs.items.map((cr) => ({
    realm: cr.spec.realmId,
    clientId: cr.spec.clientId,
  }));

  const managedClients = realmAmededClients.filter(isClaimed);

  const lingeringClients = managedClients.filter((r) => {
    if (r.clientId == null) {
      throw new Error(`clientId not defined`);
    }
    return crManagedClients.some((c) => {
      return !(c.clientId === r.clientId && c.realm === r.realm);
    });
  }) as ((typeof managedClients)[number] & { realm: string })[];

  for (const clientRepresentation of lingeringClients) {
    // Get the old spec from the realm attributes
    const specAttributeValue = clientRepresentation.attributes
      ?.[crSpecRealmAttribute];
    let oldSpec: CustomResourceIn["spec"];
    try {
      oldSpec = zCrdSpec.parse(JSON.parse(specAttributeValue));
    } catch (error) {
      logger.error(
        `Could not parse old spec from attribute ${crSpecRealmAttribute}`,
        error,
      );
      continue;
    }
    if (!oldSpec.pruneClient) {
      continue;
    }
    await kcClient.ensureAuthed();
    logger.log(
      `Deleting lingering managed client ${clientRepresentation.clientId} in realm ${clientRepresentation.realm}`,
    );
    await kcClient.client.clients.del({
      realm: clientRepresentation.realm,
      id: clientRepresentation.clientId,
    });
  }
};
