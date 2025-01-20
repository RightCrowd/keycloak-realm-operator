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
import { type CrSelector } from "../_utils/crd-mgmt-utils.ts";
import { updateCr } from "./handlers.ts";
import type { RealmRepresentation } from "../../keycloak.ts";

const logger = new Logger("managed-realm reconciler");

const kcClient = new KeycloakClient();

const keycloakAttributePrefix = "k8s.rightcrowd.com/keycloak-realm-operator";

const claimAttributes = {
  [`${keycloakAttributePrefix}/claim`]: "true",
} satisfies Record<string, string>;

const crSpecRealmAttribute = `${keycloakAttributePrefix}/cr-spec-serialized`;

const isClaimed = (
  realm: { attributes?: RealmRepresentation["attributes"] },
) => {
  const attributes = realm.attributes ?? {};
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

  try {
    const { spec } = apiObj;
    const { realmId: realm, displayName } = spec;

    await kcClient.ensureAuthed();
    let currentKcRealm = await kcClient.client.realms.findOne({
      realm,
    });

    if (currentKcRealm == null) {
      // The realm does not exist yet. Let's create it
      logger.log(`Creating and claiming Keycloak realm ${realm}`);
      await kcClient.ensureAuthed();
      await kcClient.client.realms.create({
        realm,
        attributes: {
          ...claimAttributes,
          [crSpecRealmAttribute]: JSON.stringify(spec),
        },
        displayName,
      });
      await kcClient.ensureAuthed();
      currentKcRealm = (await kcClient.client.realms.findOne({
        realm,
      }))!;
    }

    let realmClaimed = isClaimed(currentKcRealm);
    if (!realmClaimed) {
      logger.log(`Realm ${realm} is unclaimed`);
      if (spec.claimRealm) {
        logger.log(`Claiming realm ${realm}`);
        await kcClient.ensureAuthed();
        await kcClient.client.realms.update({ realm }, {
          attributes: {
            ...currentKcRealm.attributes,
            ...claimAttributes,
          },
        });
        realmClaimed = true;
      }
    }

    if (!realmClaimed) {
      logger.error(`Realm ${realm} is not claimed and claiming is disabled`);
      await updateCr(selector, { status: { state: "failed" } });
      return;
    }

    // const specChanged =
    //   JSON.stringify(currentKcRealm.attributes?.[crSpecRealmAttribute]) !==
    //     JSON.stringify(spec);

    const attributes = {
      ...currentKcRealm.attributes,
      ...claimAttributes,
      [crSpecRealmAttribute]: JSON.stringify(spec),
    };

    // // TODO: Maybe the specChanged check should simply not be here? If someone goes in and manually changes something, we won't detect it
    // if (specChanged) {
    await kcClient.ensureAuthed();
    logger.log(`Performing update for realm ${realm}`);
    await kcClient.client.realms.update({ realm }, {
      ...spec.representation,
      attributes,
      realm: undefined,
      id: undefined,
    });
    // }

    if (spec.realmImports != null && spec.realmImports.length > 0) {
      for (const [index, realmImport] of spec.realmImports.entries()) {
        await kcClient.ensureAuthed();
        logger.log(
          `Performing partial import (index ${index}) for realm ${realm}`,
        );
        await kcClient.client.realms.partialImport({
          realm,
          rep: {
            ifResourceExists: realmImport.ifResourceExists,
            ...realmImport.import,
          },
        }, { catchNotFound: true });
      }
    }

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
  await kcClient.ensureAuthed();
  const realms = await kcClient.client.realms.find();
  const crs = (await k8sApiMC.listClusterCustomObject(
    CUSTOMRESOURCE_GROUP,
    CUSTOMRESOURCE_VERSION,
    CUSTOMRESOURCE_PLURAL,
  )).body as {
    items: CustomResourceIn[];
  };
  const crManagedRealmNames = crs.items.map((cr) => cr.spec.realmId);

  const managedRealms = realms.filter(isClaimed);
  const lingeringRealms = managedRealms.filter((r) => {
    if (r.realm == null) {
      throw new Error(`Realm not defined`);
    }
    return !crManagedRealmNames.includes(r.realm!);
  });

  for (const realmRepresentation of lingeringRealms) {
    // Get the old spec from the realm attributes
    const specAttributeValue = realmRepresentation.attributes
      ?.[crSpecRealmAttribute];
    let oldSpec: CustomResourceIn["spec"];
    const realm = realmRepresentation.realm!;
    try {
      oldSpec = zCrdSpec.parse(JSON.parse(specAttributeValue));
    } catch (error) {
      logger.error(
        `Could not parse old spec from attribute ${crSpecRealmAttribute}`,
        error,
      );
      continue;
    }
    if (!oldSpec.pruneRealm) {
      const newAttributes = Object.keys(realmRepresentation.attributes ?? {})
        ?.reduce((acc: Record<string, string>, attributeKey: string) => {
          // Only keep the attributes not related to the operator
          if (!attributeKey.startsWith(keycloakAttributePrefix)) {
            acc[attributeKey] = realmRepresentation.attributes![attributeKey]!;
          }
          return acc;
        }, {});
      logger.log(`Dropping claim of realm ${realm}`, {
        newAttributes,
      });
      await kcClient.ensureAuthed();
      await kcClient.client.realms.update({ realm }, {
        attributes: newAttributes,
      });
      continue;
    }
    logger.log(`Deleting lingering managed realm ${realm}`);
    await kcClient.ensureAuthed();
    await kcClient.client.realms.del({ realm });
  }
};
