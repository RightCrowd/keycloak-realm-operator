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
import type { RealmRepresentation } from '../../keycloak.ts';

const logger = new Logger("managed-realm reconciler");

const kcClient = new KeycloakClient();

const claimAttributes = {
  'k8s.rightcrowd.com/keycloak-realm-operator/claim': 'true'
} satisfies Record<string, string>

const realmIsClaimed = (realm: { attributes?: RealmRepresentation['attributes'] }) => {
  const attributes = realm.attributes ?? {};
  const expectedAttributes = claimAttributes as Record<string, string>
  const differ = Object.keys(expectedAttributes).some((expectedKey: string) => attributes[expectedKey] !== expectedAttributes[expectedKey])
  return !differ
}

export const reconcileResource = async (
  apiObj: CustomResourceIn,
  selector: CrSelector,
) => {
  logger.log(
    `Reconciling CR`,
    selector,
  );
  await updateCr(selector, { status: { state: "syncing" } });

  const { spec } = apiObj
  const { realmId: realm, displayName } = spec

  let currentKcRealm = await kcClient.client.realms.findOne({
    realm
  })

  if (currentKcRealm == null) {
    // The realm does not exist yet. Let's create it
    logger.log(`Creating and claiming Keycloak realm ${realm}`)
    await kcClient.client.realms.create({
      realm,
      attributes: claimAttributes,
      displayName
    })
    currentKcRealm = (await kcClient.client.realms.findOne({
      realm
    }))!
  }

  let realmClaimed = realmIsClaimed(currentKcRealm)
  if (!realmClaimed) {
    logger.log(`Realm ${realm} is unclaimed`)
    if (spec.claimRealm) {
      logger.log(`Claiming realm ${realm}`)
      await kcClient.client.realms.update({ realm }, {
        attributes: {
          ...currentKcRealm.attributes,
          ...claimAttributes
        }
      })
      realmClaimed = true
    }
  }

  if (!realmClaimed) {
    logger.error(`Realm ${realm} is not claimed and claiming is disabled`)
    await updateCr(selector, { status: { state: "failed" } });
    return
  }

  /*
  TODO: By performing a partial import in every reconiliciation, we're very sure the state of the realm is always turned into the desired state. However, we still have to test and make sure this isn't too heavy on Keycloak!
  */
  await kcClient.client.realms.partialImport({
    realm: apiObj.spec.realmId,
    rep: spec.representation
  })
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
        )
      }
  }

// export const cleanup = async () => {
//   const namespaces = (await k8sApiPods.listNamespace()).body.items;
//   const secrets: V1Secret[] = [];
//   const customResources: CustomResourceOut[] = [];
//   for (const namespace of namespaces) {
//     if (namespace.metadata?.name != null) {
//       const ns = namespace.metadata.name;
//       secrets.push(...(await k8sApiPods.listNamespacedSecret(ns)).body.items);
//       customResources.push(
//         ...((await k8sApiMC.listNamespacedCustomObject(
//           CUSTOMRESOURCE_GROUP,
//           CUSTOMRESOURCE_VERSION,
//           ns,
//           CUSTOMRESOURCE_PLURAL,
//         )).body as { items: CustomResourceOut[] }).items,
//       );
//     }
//   }
//   const managedSecrets = secrets.filter((s) =>
//     s.metadata?.annotations?.[sourceAnnotationKey] != null
//   );

//   const lingeringManagedSecrets = managedSecrets.filter((s) => {
//     if (s.metadata?.name == null || s.metadata?.namespace == null) {
//       return true;
//     }
//     const matchExists = customResources.some((cr) =>
//       cr.spec.targetSecretName === s.metadata!.name! &&
//       cr.metadata.namespace === s.metadata!.namespace!
//     );
//     return !matchExists;
//   });

//   for (const secret of lingeringManagedSecrets) {
//     await k8sApiPods.deleteNamespacedSecret(
//       secret.metadata!.name!,
//       secret.metadata!.namespace!,
//     );
//   }
// };

