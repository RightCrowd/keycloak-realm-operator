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
import {
  type CrSelector,
  CrSelectorWithUid,
  logCrEvent,
} from "../crd-mgmt-utils.ts";
import { updateCr } from "./handlers.ts";
import type { ClientRepresentation } from "../../keycloak.ts";
import { k8sApiPods } from "../../k8s.ts";

const logger = new Logger("managed-client reconciler");

const kcClient = new KeycloakClient();

const keycloakAttributePrefix = "k8s.rightcrowd.com/keycloak-realm-operator";

const claimAttributes = {
  [`${keycloakAttributePrefix}/claim`]: "true",
} satisfies Record<string, string>;

const crSpecRealmAttribute = `${keycloakAttributePrefix}/cr-spec-serialized`;

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
  _selector: CrSelector,
) => {
  const selector: CrSelectorWithUid = {
    ..._selector,
    uid: apiObj.metadata.uid,
  };
  logger.log(
    `Reconciling CR`,
    selector,
  );
  await updateCr(selector, { status: { state: "syncing" } });

  try {
    const { spec } = apiObj;
    const { realmId: realm, clientId: id } = spec;

    // Make sure the realm exists
    await kcClient.ensureAuthed();
    if ((await kcClient.client.realms.findOne({ realm })) == null) {
      logger.error(`Realm not found ${realm}`);
      await updateCr(selector, { status: { state: "failed" } });
      await logCrEvent(selector, {
        message: `Realm ${realm} not found`,
        type: "Warning",
        reason: "Syncing",
      });
      return;
    }

    await kcClient.ensureAuthed();
    let currentKcClient = await kcClient.client.clients.findOne({
      realm,
      id,
    });

    if (currentKcClient == null) {
      // The client does not exist yet. Let's create it
      logger.log(
        `Creating and claiming Keycloak client ${id} in realm ${realm}`,
      );
      await logCrEvent(selector, {
        message:
          `Creating and claiming Keycloak client ${id} in realm ${realm}`,
        reason: "Syncing",
      });
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
      await logCrEvent(selector, {
        message: `Client ${id} is unclaimed in realm ${realm}`,
        reason: "Syncing",
      });
      if (spec.claimClient) {
        logger.log(`Claiming client ${id} in realm ${realm}`);
        await logCrEvent(selector, {
          message: `Claiming client ${id} in realm ${realm}`,
          reason: "Syncing",
        });
        await kcClient.ensureAuthed();
        await kcClient.client.clients.update({ realm, id }, {
          attributes: {
            ...currentKcClient.attributes,
            ...claimAttributes,
          },
        });
        claimed = true;
      }
    }

    if (!claimed) {
      logger.error(
        `Client ${id} in realm ${realm} is not claimed and claiming is disabled`,
      );
      await logCrEvent(selector, {
        message:
          `Client ${id} in realm ${realm} is not claimed and claiming is disabled`,
        type: "Warning",
        reason: "Syncing",
      });
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

    // const specChanged =
    //   JSON.stringify(currentKcClient.attributes?.[crSpecRealmAttribute]) !==
    //     JSON.stringify(spec);

    const attributes = {
      ...currentKcClient.attributes,
      ...claimAttributes,
      [crSpecRealmAttribute]: JSON.stringify(spec),
    };

    // // TODO: Maybe the specChanged check should simply not be here? If someone goes in and manually changes something, we won't detect it
    // if (specChanged) {
    await kcClient.ensureAuthed();
    logger.log(`Performing update for client ${id} in realm ${realm}`);
    await logCrEvent(selector, {
      message: `Performing update for client ${id} in realm ${realm}`,
      reason: "Syncing",
    });
    await kcClient.client.clients.update({ realm, id }, {
      ...spec.representation,
      secret,
      attributes,
      id: undefined,
      clientId: undefined,
    });
    // }

    await logCrEvent(selector, {
      message: `Synced successfully`,
      reason: "Syncing",
    });
    await updateCr(selector, { status: { state: "synced" } });
  } catch (error) {
    logger.error("Error reconciling resource", {
      selector,
      error,
    });
    await updateCr(selector, { status: { state: "failed" } });
  }
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

  for (const { cr, selector } of crsAndSelectors) {
    try {
      await reconcileResource(
        zCustomResourceIn.parse(cr),
        selector,
      );
    } catch (error) {
      logger.error("Error reconciling resource", {
        selector,
        error,
      });
      await updateCr(selector, { status: { state: "failed" } });
    }
  }
};

export const cleanup = async () => {
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

  await kcClient.ensureAuthed();
  const realms = await kcClient.client.realms.find();
  for (const realmRepresentation of realms) {
    const { realm } = realmRepresentation;
    if (realm == null) {
      continue;
    }

    await kcClient.ensureAuthed();
    const clients = await kcClient.client.clients.find({ realm });

    const managedClients = clients.filter(isClaimed);
    const lingeringClients = managedClients.filter((r) => {
      if (r.clientId == null) {
        throw new Error(`clientId not defined`);
      }
      return crManagedClients.some((cr) => {
        return !(cr.clientId === r.clientId && cr.realm === realm);
      });
    });

    for (const clientRepresentation of lingeringClients) {
      if (clientRepresentation.clientId == null) {
        continue;
      }
      // Get the old spec from the attributes
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
        const newAttributes = Object.keys(clientRepresentation.attributes ?? {})
          ?.reduce(
            (acc: Record<string, string | null>, attributeKey: string) => {
              // Only keep the attributes not related to the operator
              if (!attributeKey.startsWith(keycloakAttributePrefix)) {
                acc[attributeKey] = clientRepresentation
                  .attributes![attributeKey]!;
              } else {
                acc[attributeKey] = null;
              }
              return acc;
            },
            {},
          );
        logger.log(
          `Dropping claim of client ${clientRepresentation.clientId} in realm ${realm}`,
          { newAttributes },
        );
        await kcClient.ensureAuthed();
        await kcClient.client.clients.update({
          realm,
          id: clientRepresentation.clientId,
        }, {
          attributes: newAttributes,
        });
        continue;
      }
      await kcClient.ensureAuthed();
      logger.log(
        `Deleting lingering managed client ${clientRepresentation.clientId} in realm ${realm}`,
      );
      await kcClient.client.clients.del({
        realm,
        id: clientRepresentation.clientId,
      });
    }
  }
};
