import KcAdminClient from "npm:@keycloak/keycloak-admin-client";
import z, { AnyZodObject } from "npm:zod";
import { ZodSchema } from "npm:zod";
import { Logger } from "../util.ts";
import { KeycloakClient } from "../keycloak.ts";
import {
  CrSelector,
  updateCr as updateCrGeneric,
  validateCrHash,
  zBasicCr,
} from "./crd-mgmt-utils.ts";
import { k8sApiMC, watcher } from "../k8s.ts";
import { Queue, Worker } from "npm:bullmq";
import { getConfig } from "../config.ts";
import { host, password, port, username } from "../redis.ts";

const zCrdStatus = z.object({
  state: z.enum([
    "not-synced",
    "out-of-sync",
    "syncing",
    "synced",
    "failed",
  ]).optional(),
}).optional();

export const makeZCustomResourceSchema = <
  SpecSchema extends AnyZodObject = AnyZodObject,
>(spec: SpecSchema) =>
  z.object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z.object({
      uid: z.string(),
      name: z.string(),
      annotations: z.record(z.string(), z.string()).optional(),
    }).passthrough(),
    spec: spec.extend({
      prune: z.boolean().optional(),
      claim: z.boolean().optional(),
      realm: z.string(),
      //   id: z.string(),
      representation: z.any(),
    }),
    status: zCrdStatus,
  });

type KcSubResource = keyof InstanceType<typeof KcAdminClient>;
const allowedSubresources = [
  "clients",
  "clientScopes",
  "groups",
] as const satisfies KcSubResource[];

type GenericKcInRealmResourceCrSpecsBase<
  SubRes extends (typeof allowedSubresources)[number] =
    (typeof allowedSubresources)[number],
> = {
  kcClientSubresource: SubRes;
  crdIdentifiers: {
    group: string;
    plural: string;
    version: string;
    kind: string;
  };
  validationSchemas: {
    customResourceIn: ZodSchema;
    customResourceOut: ZodSchema;
  };
  //   findIdMapper: (crSpec: unknown) => Partial<Awaited<ReturnType<InstanceType<typeof KcAdminClient>[SubRes]['findOne']>>>;
  //   createIdMapper: (crSpec: unknown) => Partial<Awaited<ReturnType<InstanceType<typeof KcAdminClient>[SubRes]['findOne']>>>
};

type GenericKcInRealmResourceCrSpecs<
  T extends GenericKcInRealmResourceCrSpecsBase,
> = T;

const keycloakAttributePrefix = "k8s.rightcrowd.com/keycloak-realm-operator";
const claimAttribute = {
  [`${keycloakAttributePrefix}/claim`]: "true",
};
const crSpecRealmAttributeKey = `${keycloakAttributePrefix}/cr-spec-serialized`;

type ReconcilerJobData<T extends GenericKcInRealmResourceCrSpecsBase> = {
  all?: boolean;
  instances?: {
    apiObj: z.output<T["validationSchemas"]["customResourceIn"]>;
    selector: CrSelector;
  }[];
};

export class kcInRealmResourceCr<
  T extends GenericKcInRealmResourceCrSpecsBase,
> {
  private reconcilerLogger: Logger;
  private cleanupLogger: Logger;
  private crdHandlerLogger: Logger;
  private reconciliationQueueLogger: Logger;
  private cleanupQueueLogger: Logger;

  private kcClient: KeycloakClient;
  private updateCr;

  private reconciliationJobName;
  private reconciliationJobQueueName;
  private reconciliationQueue;
  private reconciliationWorker;

  private cleanupJobName;
  private cleanupJobQueueName;
  private cleanupQueue;
  private cleanupWorker;

  constructor(private options: GenericKcInRealmResourceCrSpecs<T>) {
    this.reconcilerLogger = new Logger(
      `${options.crdIdentifiers.plural} reconciler`,
    );
    this.cleanupLogger = new Logger(
      `${options.crdIdentifiers.plural} cleanup`,
    );
    this.crdHandlerLogger = new Logger(
      `${options.crdIdentifiers.plural} crd handler`,
    );
    this.reconciliationQueueLogger = new Logger(
      `${options.crdIdentifiers.plural} reconciliation queue`,
    );
    this.cleanupQueueLogger = new Logger(
        `${options.crdIdentifiers.plural} cleanup queue`,
      );

    this.kcClient = new KeycloakClient();
    this.updateCr = updateCrGeneric<
      z.input<T["validationSchemas"]["customResourceOut"]>
    >;


    this.reconciliationJobName =
      `${this.options.crdIdentifiers.plural}-reconciliation`;
    this.reconciliationJobQueueName = `${this.reconciliationJobName}-queue`;

    this.reconciliationQueue = new Queue<
      ReconcilerJobData<T>,
      unknown,
      string
    >(this.reconciliationJobQueueName, {
      connection: {
        host,
        port,
        password,
        username,
      },
    });

    this.reconciliationWorker = new Worker<
      ReconcilerJobData<T>,
      unknown,
      string
    >(
      this.reconciliationJobQueueName,
      async (job) => {
        if (job.data.all) {
          try {
            this.reconciliationQueueLogger.log(
              `Reconciling all ${this.options.crdIdentifiers.plural} resources`,
            );
            await this.reconcileAllResources();
            this.reconciliationQueueLogger.log(
              `Finished scheduled ${this.options.crdIdentifiers.plural} reconciliation`,
            );
          } catch (error) {
            console.error(error);
            throw error;
          }
        }
        if (job.data.instances != null && job.data.instances.length) {
          for (const instance of job.data.instances) {
            const { selector, apiObj } = instance;
            this.reconciliationQueueLogger.log(
              `Reconciling ${this.options.crdIdentifiers.plural} resource`,
              instance.selector,
            );
            await this.reconcileResource(apiObj, selector);
          }
        }
      },
      {
        connection: {
          host,
          port,
          password,
          username,
        },
        concurrency: 1,
        autorun: getConfig().ENABLE_WORKERS,
      },
    );


    this.cleanupJobName =
    `${this.options.crdIdentifiers.plural}-cleanup`;
    this.cleanupJobQueueName = `${this.cleanupJobName}-queue`;

    this.cleanupQueue = new Queue<
      unknown,
      unknown,
      string
    >(this.cleanupJobQueueName, {
      connection: {
        host,
        port,
        password,
        username,
      },
    });

    this.cleanupWorker = new Worker<
      unknown,
      unknown,
      string
    >(
    this.cleanupJobQueueName,
      async (_job) => {
        try {
          this.cleanupQueueLogger.log(
            `Performing scheduled ${this.options.crdIdentifiers.plural} cleanup`,
          );
          await this.cleanupResources();
          this.cleanupQueueLogger.log(`Finished scheduled ${this.options.crdIdentifiers.plural} cleanup`);
        } catch (error) {
          console.error(error);
          throw error;
        }
      },
      {
        connection: {
          host,
          port,
          password,
          username,
        },
        concurrency: 1,
        autorun: getConfig().ENABLE_WORKERS,
      },
    )
  }

  makeSelector(name: string): CrSelector {
    return {
      ...this.options.crdIdentifiers,
      name,
    };
  }

  isClaimed = (
    subResource: NonNullable<
      Awaited<
        ReturnType<
          typeof this.kcClient.client[typeof this.options.kcClientSubresource][
            "findOne"
          ]
        >
      >
    >,
  ) => {
    const attributes = subResource.attributes ?? {};
    const expectedAttributes = claimAttribute as Record<string, string>;
    const differ = Object.keys(expectedAttributes).some((expectedKey: string) =>
      attributes[expectedKey] !== expectedAttributes[expectedKey]
    );
    return !differ;
  };

  async reconcileResource(
    apiObj: z.output<T["validationSchemas"]["customResourceIn"]>,
    selector: CrSelector,
  ) {
    this.reconcilerLogger.log(`Reconciling CR`, apiObj);
    await this.updateCr(selector, { status: { state: "syncing" } });

    const subResourceName = this.options.kcClientSubresource;
    const subResourceClient = this.kcClient.client[subResourceName];

    try {
      const { spec } = apiObj;
      const { realm, id } = spec;

      // Make sure the realm exists
      await this.kcClient.ensureAuthed();
      if ((await this.kcClient.client.realms.findOne({ realm })) == null) {
        this.reconcilerLogger.error(`Realm not found ${realm}`);
        await this.updateCr(selector, { status: { state: "failed" } });
        return;
      }

      await this.kcClient.ensureAuthed();
      let currentKcSubresource = await subResourceClient.findOne({
        realm,
        id,
      });

      if (currentKcSubresource == null) {
        // The resource does not exist yet. Let's create it
        this.reconcilerLogger.log(
          `Creating and claiming Keycloak ${subResourceName} ${id} in realm ${realm}`,
        );
        await this.kcClient.ensureAuthed();
        await subResourceClient.create({
          realm,
          id,
          name: spec.name,
          attributes: {
            ...claimAttribute,
            [crSpecRealmAttributeKey]: JSON.stringify(spec),
          },
        });
        await this.kcClient.ensureAuthed();
        currentKcSubresource = (await subResourceClient.findOne({
          realm,
          id,
        }))!;
      }

      let claimed = this.isClaimed(currentKcSubresource);
      if (!claimed) {
        this.reconcilerLogger.log(
          `${subResourceName} ${id} is unclaimed in realm ${realm}`,
        );
        if (spec.claim) {
          this.reconcilerLogger.log(
            `Claiming ${subResourceName} ${id} in realm ${realm}`,
          );
          await this.kcClient.ensureAuthed();
          await subResourceClient.update({ realm, id }, {
            attributes: {
              ...currentKcSubresource.attributes,
              ...claimAttribute,
            },
          });
          claimed = true;
        }
      }

      if (!claimed) {
        this.reconcilerLogger.error(
          `${subResourceName} ${id} in realm ${realm} is not claimed and claiming is disabled`,
        );
        await this.updateCr(selector, { status: { state: "failed" } });
        return;
      }

      const attributes = {
        ...currentKcSubresource.attributes,
        ...claimAttribute,
        [crSpecRealmAttributeKey]: JSON.stringify(spec),
      };

      await this.kcClient.ensureAuthed();
      this.reconcilerLogger.log(
        `Performing update for ${subResourceName} ${id} in realm ${realm}`,
      );
      await subResourceClient.update({ realm, id }, {
        ...spec.representation,
        attributes,
        id: undefined,
      });

      await this.updateCr(selector, { status: { state: "synced" } });
    } catch (error) {
      this.reconcilerLogger.error("Error reconciling resource", {
        selector,
        error,
      });
      await this.updateCr(selector, { status: { state: "failed" } });
    }
  }

  async reconcileAllResources() {
    const crs = ((await k8sApiMC.listClusterCustomObject(
      this.options.crdIdentifiers.group,
      this.options.crdIdentifiers.version,
      this.options.crdIdentifiers.plural,
    )).body as {
      items: z.output<T["validationSchemas"]["customResourceIn"]>[];
    }).items;
    const crsAndSelectors = crs.map((cr) => ({
      cr,
      selector: this.makeSelector(cr.metadata.name),
    }));

    for (const { cr, selector } of crsAndSelectors) {
      await this.reconcileResource(
        this.options.validationSchemas.customResourceIn.parse(cr),
        selector,
      );
    }
  }

  async cleanupResources() {
    const crs = (await k8sApiMC.listClusterCustomObject(
      this.options.crdIdentifiers.group,
      this.options.crdIdentifiers.version,
      this.options.crdIdentifiers.plural,
    )).body as {
      items: z.output<T["validationSchemas"]["customResourceIn"]>[];
    };
    const subResourceName = this.options.kcClientSubresource;
    const subResourceClient = this.kcClient.client[subResourceName];

    const crManagedSubresource = crs.items.map((cr) => ({
      realm: cr.spec.realmId,
      id: cr.spec.id,
    }));

    await this.kcClient.ensureAuthed();
    const realms = await this.kcClient.client.realms.find();
    for (const realmRepresentation of realms) {
      const { realm } = realmRepresentation;
      if (realm == null) {
        continue;
      }

      await this.kcClient.ensureAuthed();
      const subResources = await subResourceClient.find({ realm });

      const managedSubResources = subResources.filter(this.isClaimed);
      const lingeringSubResources = managedSubResources.filter((r) => {
        if (r.id == null) {
          throw new Error(`id not defined`);
        }
        return !crManagedSubresource.some((cr) =>
          cr.id === r.id && cr.realm === realm
        );
      });

      for (const subResourcesRepresentation of lingeringSubResources) {
        if (subResourcesRepresentation.id == null) {
          continue;
        }
        // Get the old spec from the attributes
        const specAttributeValue = subResourcesRepresentation.attributes
          ?.[crSpecRealmAttributeKey];
        let oldSpec: z.output<
          T["validationSchemas"]["customResourceIn"]
        >["spec"];
        try {
          oldSpec =
            ((this.options.validationSchemas.customResourceIn as AnyZodObject)
              .pick({ spec: true }).parse({
                spec: JSON.parse(specAttributeValue),
                // deno-lint-ignore no-explicit-any
              }) as { spec: any }).spec;
        } catch (error) {
          this.cleanupLogger.error(
            `Could not parse old spec from attribute ${crSpecRealmAttributeKey}`,
            error,
          );
          continue;
        }
        if (!oldSpec.pruneClient) {
          const newAttributes = Object.keys(
            subResourcesRepresentation.attributes ?? {},
          )
            ?.reduce(
              (acc: Record<string, string | null>, attributeKey: string) => {
                // Only keep the attributes not related to the operator
                if (!attributeKey.startsWith(keycloakAttributePrefix)) {
                  acc[attributeKey] = subResourcesRepresentation
                    .attributes![attributeKey]!;
                } else {
                  acc[attributeKey] = null;
                }
                return acc;
              },
              {},
            );
          this.cleanupLogger.log(
            `Dropping claim of ${subResourceName} ${subResourcesRepresentation.id} in realm ${realm}`,
            { newAttributes },
          );
          await this.kcClient.ensureAuthed();
          await subResourceClient.update({
            realm,
            id: subResourcesRepresentation.id,
          }, {
            attributes: newAttributes,
          });
          continue;
        }
        await this.kcClient.ensureAuthed();
        this.cleanupLogger.log(
          `Deleting lingering managed ${subResourceName} ${subResourcesRepresentation.id} in realm ${realm}`,
        );
        await subResourceClient.del({
          realm,
          id: subResourcesRepresentation.id,
        });
      }
    }
  }

  async onEventHandler(
    _phase: string,
    apiObj: object,
  ) {
    const phase = _phase as "ADDED" | "MODIFIED" | "DELETED";
    const parsedApiObj = this.options.validationSchemas.customResourceIn.parse(
      apiObj,
    );

    const selector = this.makeSelector(parsedApiObj.metadata.name);
    this.crdHandlerLogger.debug(
      `Event received for CRD ${this.options.crdIdentifiers.plural}: ${phase}`,
      selector,
    );

    // Set initial state
    if (parsedApiObj.status?.state == null) {
      await this.updateCr(selector, { status: { state: "not-synced" } });
    }

    if (
      (phase === "ADDED" || phase === "MODIFIED") &&
      !(await validateCrHash(zBasicCr.parse(apiObj)))
    ) {
      await this.addReconciliationJob({
        instances: [{
          apiObj: parsedApiObj,
          selector,
        }],
      });
    }

    if (phase === "DELETED") {
      await this.scheduleCleanupJobNow();
    }
  }

  async startWatching() {
    /* Watch client credentials custom resource */
    await watcher.watch(
      `/apis/${this.options.crdIdentifiers.group}/${this.options.crdIdentifiers.version}/${this.options.crdIdentifiers.plural}`,
      {},
      this.onEventHandler,
      async (err) => {
        this.crdHandlerLogger.log("Connection closed", err);
        this.crdHandlerLogger.info("Restarting watcher");
        await this.startWatching();
      },
    );
  }

  async scheduleReconciliationJobs() {
    await this.reconciliationQueue.upsertJobScheduler(
      this.reconciliationJobName,
      { pattern: "* * * * *" },
      {
        name: this.reconciliationJobName,
        data: {
          all: true,
        },
        opts: {
          priority: 100,
        },
      },
    );
  }

  async scheduleReconciliationJobNow() {
    await this.reconciliationQueue.promoteJobs();
  }

  async addReconciliationJob(data: ReconcilerJobData<T>) {
    await this.reconciliationQueue.add(
      this.reconciliationJobName,
      data,
      // Give a 'new' job greater priority than a scheduled job
      {
        priority: 10,
      },
    );
  }

  async scheduleCleanupJobs () {
    await this.cleanupQueue.upsertJobScheduler(
      this.cleanupJobName,
      { pattern: "* * * * *" },
      {
        name: this.cleanupJobName,
        data: {},
        opts: {
          priority: 100,
        },
      },
    );
  };

  async scheduleCleanupJobNow () {
    this.cleanupQueueLogger.log("Promoting cleanup job");
    await this.cleanupQueue.promoteJobs();
  };
}
