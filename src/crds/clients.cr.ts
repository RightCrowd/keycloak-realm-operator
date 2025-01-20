import z from "npm:zod";
import { CrSelector } from "./_utils/crd-mgmt-utils.ts";
import {
  claimAttribute,
  crSpecRealmAttributeKey,
  type GenericKcInRealmResourceCrSpecs,
  type GenericKcInRealmResourceCrSpecsBase,
  kcInRealmResourceCr,
  makeZCustomResourceSchema,
} from "./_utils/genericKcInRealmResourceCr.ts";
import { k8sApiPods } from "../k8s.ts";

type GenericKcInRealmResourceCrSpecsBase_ClientScoped =
  GenericKcInRealmResourceCrSpecsBase<"clients">;

class kcInRealmClientCr<
  T extends GenericKcInRealmResourceCrSpecsBase_ClientScoped,
> extends kcInRealmResourceCr<T> {
  constructor(options: GenericKcInRealmResourceCrSpecs<T>) {
    super(options);
  }

  override reconcileResource = async (
    apiObj: z.output<T["validationSchemas"]["customResourceIn"]>,
    selector: CrSelector,
  ) => {
    this.reconcilerLogger.log(`Reconciling CR`, apiObj);
    await this.updateCr(selector, { status: { state: "syncing" } });

    const subResourceName = this.options.kcClientSubresource;
    const subResourceClient = this.kcClient.client[subResourceName];

    try {
      const spec = apiObj.spec as z.infer<typeof clientCrdSpecificSpecs>;
      const { realm } = spec;

      const mappers = this.getMappers(spec);

      // Make sure the realm exists
      await this.kcClient.ensureAuthed();
      if ((await this.kcClient.client.realms.findOne({ realm })) == null) {
        this.reconcilerLogger.error(`Realm not found ${realm}`);
        await this.updateCr(selector, { status: { state: "failed" } });
        return;
      }

      await this.kcClient.ensureAuthed();
      const allSubresources = await subResourceClient.find({ realm });
      let currentKcSubresource = allSubresources.find(mappers.findFilterFn);
      let id = currentKcSubresource?.id;

      if (currentKcSubresource == null) {
        // The resource does not exist yet. Let's create it
        this.reconcilerLogger.log(
          `Creating and claiming Keycloak ${subResourceName} ${mappers.humanReadaleId} in realm ${realm}`,
        );
        await this.kcClient.ensureAuthed();
        id = (await subResourceClient.create({
          realm,
          ...mappers.create,
          ...spec.representation,
          attributes: {
            ...this.options.defaultAttributes,
            ...claimAttribute,
            [crSpecRealmAttributeKey]: JSON.stringify(spec),
          },
        })).id;
        await this.kcClient.ensureAuthed();
        currentKcSubresource = (await subResourceClient.findOne({
          realm,
          id,
        }))!;
      }

      id = id!;

      let claimed = this.isClaimed(currentKcSubresource);
      if (!claimed) {
        this.reconcilerLogger.log(
          `${subResourceName} ${mappers.humanReadaleId} is unclaimed in realm ${realm}`,
        );
        if (spec.claim) {
          if (spec.recreateOnClaim) {
            this.reconcilerLogger.log(
              `Recreating and claiming ${subResourceName} ${mappers.humanReadaleId} in realm ${realm}`,
            );
            await this.kcClient.ensureAuthed();
            await subResourceClient.del({ realm, id });
            id = (await subResourceClient.create({
              realm,
              ...mappers.create,
              ...spec.representation,
              attributes: {
                ...this.options.defaultAttributes,
                ...claimAttribute,
                [crSpecRealmAttributeKey]: JSON.stringify(spec),
              },
            })).id;
            claimed = true;
          } else {
            this.reconcilerLogger.log(
              `Claiming ${subResourceName} ${mappers.humanReadaleId} in realm ${realm}`,
            );
            await this.kcClient.ensureAuthed();
            await subResourceClient.update({ realm, id }, {
              ...mappers.update,
              attributes: {
                ...currentKcSubresource.attributes,
                ...claimAttribute,
              },
            });
            claimed = true;
          }
        }
      }

      if (!claimed) {
        this.reconcilerLogger.error(
          `${subResourceName} ${mappers.humanReadaleId} in realm ${realm} is not claimed and claiming is disabled`,
        );
        await this.updateCr(selector, { status: { state: "failed" } });
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

      const attributes = {
        ...this.options.defaultAttributes,
        ...currentKcSubresource.attributes,
        ...claimAttribute,
        [crSpecRealmAttributeKey]: JSON.stringify(spec),
      };

      await this.kcClient.ensureAuthed();
      this.reconcilerLogger.log(
        `Performing update for ${subResourceName} ${mappers.humanReadaleId} in realm ${realm}`,
      );
      await subResourceClient.update({ realm, id }, {
        ...mappers.update,
        ...spec.representation,
        attributes,
        secret,
      });

      //#region Reconcile client scopes
      await this.kcClient.ensureAuthed();
      const _actualScopesArr = await Promise.all([
        subResourceClient.listOptionalClientScopes({ realm, id }),
        subResourceClient.listDefaultClientScopes({ realm, id }),
      ]);
      const allClientScopes = await this.kcClient.client.clientScopes.find({
        realm,
      });

      const actualScopes = {
        optional: _actualScopesArr[0],
        default: _actualScopesArr[1],
      };
      const desiredScopes = {
        optional: spec.scopes?.optional ?? [],
        default: spec.scopes?.default ?? [],
      };
      const lingeringScopes = {
        optional: actualScopes.optional.filter((s) =>
          !desiredScopes.optional.some((desired) => s.name === desired)
        ),
        default: actualScopes.default.filter((s) =>
          !desiredScopes.default.some((desired) => s.name === desired)
        ),
      };
      const missingScopes = {
        optional: desiredScopes.optional.filter((s) =>
          !actualScopes.optional.some((desired) => s === desired.name)
        ),
        default: desiredScopes.default.filter((s) =>
          !actualScopes.default.some((desired) => s === desired.name)
        ),
      };

      await this.kcClient.ensureAuthed();
      await Promise.all([
        ...lingeringScopes.optional.map((lingeringScope) => {
          if (lingeringScope.id == null) {
            return;
          }
          return subResourceClient.delOptionalClientScope({
            realm,
            clientScopeId: lingeringScope.id,
            id,
          });
        }),
        ...lingeringScopes.default.map((lingeringScope) => {
          if (lingeringScope.id == null) {
            return;
          }
          return subResourceClient.delDefaultClientScope({
            realm,
            clientScopeId: lingeringScope.id,
            id,
          });
        }),
      ]);

      await this.kcClient.ensureAuthed();
      await Promise.all([
        ...missingScopes.optional.map((missingScopeName) => {
          const missingScopeId = allClientScopes.find((s) =>
            s.name === missingScopeName
          )?.id;
          if (missingScopeId == null) {
            return;
          }
          return subResourceClient.addOptionalClientScope({
            realm,
            clientScopeId: missingScopeId,
            id,
          });
        }),
        ...missingScopes.default.map((missingScopeName) => {
          const missingScopeId = allClientScopes.find((s) =>
            s.name === missingScopeName
          )?.id;
          if (missingScopeId == null) {
            return;
          }
          return subResourceClient.addDefaultClientScope({
            realm,
            clientScopeId: missingScopeId,
            id,
          });
        }),
      ]);
      //#endregion

      await this.updateCr(selector, { status: { state: "synced" } });
    } catch (error) {
      this.reconcilerLogger.error("Error reconciling resource", {
        selector,
        error,
      });
      await this.updateCr(selector, { status: { state: "failed" } });
    }
  };
}

const clientCrdSpecificSpecs = z.object({
  realm: z.string(),
  clientId: z.string(),
  name: z.string().optional(),
  claim: z.boolean().optional(),
  prune: z.boolean().optional(),
  recreateOnClaim: z.boolean().optional(),
  secret: z.object({
    value: z.string(),
  }).or(z.object({
    valueFrom: z.object({
      secretKeyRef: z.object({
        namespace: z.string(),
        name: z.string(),
        key: z.string(),
      }),
    }),
  })).optional(),
  scopes: z.object({
    default: z.array(z.string()).optional(),
    optional: z.array(z.string()).optional(),
  }).optional(),
  representation: z.any(),
});

export const clientsCr = new kcInRealmClientCr({
  crdIdentifiers: {
    group: "k8s.rightcrowd.com",
    version: "v1alpha1",
    plural: "keycloakclients",
    kind: "KeycloakClient",
  },
  kcClientSubresource: "clients",
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(clientCrdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(clientCrdSpecificSpecs),
  },
  idMappers: {
    find: (spec: z.infer<typeof clientCrdSpecificSpecs>) => ({
      clientId: spec.clientId,
    }),
    create: (spec: z.infer<typeof clientCrdSpecificSpecs>) => ({
      clientId: spec.clientId,
      name: spec.name,
    }),
    update: (spec: z.infer<typeof clientCrdSpecificSpecs>) => ({
      clientId: spec.clientId,
      name: spec.name,
    }),
    humanReadable: (spec: z.infer<typeof clientCrdSpecificSpecs>) =>
      spec.clientId,
  },
});
