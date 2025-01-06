import {
  CUSTOMRESOURCE_GROUP,
  CUSTOMRESOURCE_PLURAL,
  CUSTOMRESOURCE_VERSION,
  type CustomResourceIn,
  makeSelector,
  zCustomResourceIn,
} from "./schemas.ts";
import { k8sApiMC } from "../../k8s.ts";
import { KeycloakClient } from "../../keycloak.ts";
import { Logger } from "../../util.ts";
import { type CrSelector } from "../crd-mgmt-utils.ts";
import { updateCr } from "./handlers.ts";
import type { RealmRepresentation } from "../../keycloak.ts";

const logger = new Logger("managed-realm reconciler");

const kcClient = new KeycloakClient();

const claimAttributes = {
  "k8s.rightcrowd.com/keycloak-realm-operator/claim": "true",
} satisfies Record<string, string>;

const realmIsClaimed = (
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
      attributes: claimAttributes,
      displayName,
    });
    await kcClient.ensureAuthed();
    currentKcRealm = (await kcClient.client.realms.findOne({
      realm,
    }))!;
  }

  let realmClaimed = realmIsClaimed(currentKcRealm);
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

  if (spec.representation != null) {
    await kcClient.ensureAuthed();
    logger.log(`Performing update for realm ${realm}`);
    kcClient.client.realms.update({ realm }, {
      ...spec.representation,
      realm: undefined,
      id: undefined,
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
  const realms = await kcClient.client.realms.find();
  const crs = (await k8sApiMC.listClusterCustomObject(
    CUSTOMRESOURCE_GROUP,
    CUSTOMRESOURCE_VERSION,
    CUSTOMRESOURCE_PLURAL,
  )).body as {
    items: CustomResourceIn[];
  };
  const crManagedRealmNames = crs.items.map((cr) => cr.spec.realmId);

  const managedRealms = realms.filter(realmIsClaimed);
  const lingeringRealms = managedRealms.filter((r) => {
    if (r.realm == null) {
      throw new Error(`Realm not defined`);
    }
    return !crManagedRealmNames.includes(r.realm!);
  });

  for (const realmRepresentation of lingeringRealms) {
    await kcClient.ensureAuthed();
    logger.log(`Deleting lingering managed realm ${realmRepresentation.realm}`);
    await kcClient.client.realms.del({ realm: realmRepresentation.realm! });
  }
};
