import z from "npm:zod";
import { CrSelector } from "../crd-mgmt-utils.ts";
import {
  claimAttribute,
  crSpecRealmAttributeKey,
  type GenericKcInRealmResourceCrSpecs,
  type GenericKcInRealmResourceCrSpecsBase,
  kcInRealmResourceCr,
  makeZCustomResourceSchema,
} from "../genericKcInRealmResourceCr.ts";
import { k8sApiPods } from "../../k8s.ts";

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
    this.reconcilerLogger.log(
      `Reconciling CR`,
      selector,
    );
    await this.updateCr(selector, { status: { state: "syncing" } });

    try {
      const { spec } = apiObj;
      const { realmId: realm, clientId: id } = spec;

      const mappers = this.getMappers(spec);

      // Make sure the realm exists
      await this.kcClient.ensureAuthed();
      if ((await this.kcClient.client.realms.findOne({ realm })) == null) {
        this.reconcilerLogger.error(`Realm not found ${realm}`);
        await this.updateCr(selector, { status: { state: "failed" } });
        return;
      }

      await this.kcClient.ensureAuthed();
      let currentKcClient = await this.kcClient.client.clients.findOne({
        realm,
        id,
      });

      if (currentKcClient == null) {
        // The client does not exist yet. Let's create it
        this.reconcilerLogger.log(
          `Creating and claiming Keycloak client ${id} in realm ${realm}`,
        );
        await this.kcClient.ensureAuthed();
        await this.kcClient.client.clients.create({
          realm,
          id,
          clientId: id,
          name: spec.name,
          attributes: {
            ...this.options.defaultAttributes,
            ...claimAttribute,
            [crSpecRealmAttributeKey]: JSON.stringify(spec),
          },
        });
        await this.kcClient.ensureAuthed();
        currentKcClient = (await this.kcClient.client.clients.findOne({
          realm,
          id,
        }))!;
      }

      let claimed = this.isClaimed(currentKcClient);
      if (!claimed) {
        this.reconcilerLogger.log(
          `Client ${mappers.humanReadaleId} is unclaimed in realm ${realm}`,
        );
        if (spec.claim) {
          if (spec.recreateOnClaim) {
            this.reconcilerLogger.log(
              `Recreating and claiming client ${mappers.humanReadaleId} in realm ${realm}`,
            );
            await this.kcClient.ensureAuthed();
            await this.kcClient.client.clients.del({ realm, id });
            await this.kcClient.client.clients.create({
              realm,
              ...mappers.create,
              ...spec.representation,
              attributes: {
                ...this.options.defaultAttributes,
                ...claimAttribute,
                [crSpecRealmAttributeKey]: JSON.stringify(spec),
              },
            });
            claimed = true;
          } else {
            this.reconcilerLogger.log(
              `Claiming client ${mappers.humanReadaleId} in realm ${realm}`,
            );
            await this.kcClient.ensureAuthed();
            await this.kcClient.client.clients.update({ realm, id }, {
              ...mappers.update,
              attributes: {
                ...currentKcClient.attributes,
                ...claimAttribute,
              },
            });
            claimed = true;
          }
        }
      }

      if (!claimed) {
        this.reconcilerLogger.error(
          `Client ${id} in realm ${realm} is not claimed and claiming is disabled`,
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
        ...currentKcClient.attributes,
        ...claimAttribute,
        [crSpecRealmAttributeKey]: JSON.stringify(spec),
      };

      await this.kcClient.ensureAuthed();
      this.reconcilerLogger.log(
        `Performing update for client ${id} in realm ${realm}`,
      );
      await this.kcClient.client.clients.update({ realm, id }, {
        ...mappers.update,
        ...spec.representation,
        secret,
        attributes,
      });
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
  id: z.string(),
  name: z.string().optional(),
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
});

export const clientsCr = new kcInRealmClientCr({
  crdIdentifiers: {
    group: "k8s.rightcrowd.com",
    version: "v1alpha1",
    plural: "keycloakusers",
    kind: "KeycloakUser",
  },
  kcClientSubresource: "clients",
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(clientCrdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(clientCrdSpecificSpecs),
  },
  idMappers: {
    find: (spec: z.infer<typeof clientCrdSpecificSpecs>) => ({
      clientId: spec.id,
    }),
    create: (spec: z.infer<typeof clientCrdSpecificSpecs>) => ({
      clientId: spec.id,
      id: spec.id,
      name: spec.name,
    }),
    update: (spec: z.infer<typeof clientCrdSpecificSpecs>) => ({
      clientId: spec.id,
      id: spec.id,
      name: spec.name,
    }),
    humanReadable: (spec: z.infer<typeof clientCrdSpecificSpecs>) => spec.id,
  },
});
