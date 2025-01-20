// deno-lint-ignore-file no-explicit-any
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
      prune: z.boolean().optional().default(true),
      claim: z.boolean().optional().default(true),
      recreateOnClaim: z.boolean().optional().default(false),
      realm: z.string(),
      //   id: z.string(),
      representation: z.any(),
    }),
    status: zCrdStatus,
  });

type KcSubResource = keyof InstanceType<typeof KcAdminClient>;
const allowedSubresources = [
  "clientScopes",
  "groups",
  "users",
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
  defaultAttributes?: Record<string, string | boolean>;
  validationSchemas: {
    customResourceIn: ZodSchema;
    customResourceOut: ZodSchema;
  };
  idMappers: {
    /** Mapper generating lookup paramaters to find the resource in Keycloak based on the CR spec */
    find: (
      crSpec: any,
    ) => Partial<
      NonNullable<
        Awaited<
          ReturnType<InstanceType<typeof KcAdminClient>[SubRes]["findOne"]>
        >
      >
    >;
    /** Mapper generating creation paramaters for the resource in Keycloak based on the CR spec */
    create: (
      crSpec: any,
    ) => Partial<
      NonNullable<
        Awaited<
          ReturnType<InstanceType<typeof KcAdminClient>[SubRes]["findOne"]>
        >
      >
    >;
    /** Mapper generating update paramaters for the resource in Keycloak based on the CR spec */
    update: (
      crSpec: any,
    ) => Partial<
      NonNullable<
        Awaited<
          ReturnType<InstanceType<typeof KcAdminClient>[SubRes]["findOne"]>
        >
      >
    >;
    /** Mapper generating a human readable identifier based on the CR spec */
    humanReadable: (crSpec: any) => string;
  };
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

type LocicOverrideUtilities<T extends GenericKcInRealmResourceCrSpecsBase = GenericKcInRealmResourceCrSpecsBase> = {
  kcClient: KeycloakClient
  options: T
  logger: Logger
}

type LogicOverrides<T extends GenericKcInRealmResourceCrSpecsBase = GenericKcInRealmResourceCrSpecsBase> = {
  precheck: (specifics: { apiObj: z.output<T["validationSchemas"]["customResourceIn"]>, selector: CrSelector }, c: LocicOverrideUtilities) => Promise<unknown>;
  findOne: (findFilterFn: (...args: any[]) => boolean, realm: string, c: LocicOverrideUtilities) => Promise<unknown>;
  create: (c: LocicOverrideUtilities) => Promise<unknown>;
  delete: (c: LocicOverrideUtilities) => Promise<unknown>;
}

const defaultLogicOverrides: LogicOverrides = {
  async precheck({ apiObj }, { kcClient, logger }) {
    const realm = apiObj?.['spec']?.['realm'] as undefined | string
    if (realm == null) {
      logger.error(`Realm not specified`);
      throw new Error(`Realm not specified`);
    }
    await kcClient.client.realms.findOne({ realm })
    await kcClient.ensureAuthed();
    if ((await kcClient.client.realms.findOne({ realm })) == null) {
      logger.error(`Realm not found ${realm}`);
      throw new Error(`Realm not found ${realm}`);
    }
  },
  async findOne(findFilterFn, realm, { kcClient, options }) {
    await kcClient.ensureAuthed();
    const allSubresources = await kcClient.client[options.kcClientSubresource].find({ realm });
    return allSubresources.find(findFilterFn);
  }
}

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

  constructor(private options: GenericKcInRealmResourceCrSpecs<T>, private logicOverrides?: Partial<LogicOverrides<T>>) {
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

    this.cleanupJobName = `${this.options.crdIdentifiers.plural}-cleanup`;
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
          this.cleanupQueueLogger.log(
            `Finished scheduled ${this.options.crdIdentifiers.plural} cleanup`,
          );
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
    );
  }

  makeSelector = (name: string): CrSelector => {
    return {
      ...this.options.crdIdentifiers,
      name,
    };
  };

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

  getMappers = (spec: any) => {
    const create = this.options.idMappers.create(spec);
    const update = this.options.idMappers.update(spec);
    const find = this.options.idMappers.find(spec);
    const humanReadaleId = this.options.idMappers.humanReadable(spec);
    const findFilterFn = (resources: any) =>
      !Object.keys(find).some((key) =>
        !((resources as any)[key] === (find as any)[key])
      );
    return {
      create,
      update,
      find,
      humanReadaleId,
      findFilterFn,
    };
  };

  reconcileResource = async (
    apiObj: z.output<T["validationSchemas"]["customResourceIn"]>,
    selector: CrSelector,
  ) => {
    this.reconcilerLogger.log(`Reconciling CR`, apiObj);
    await this.updateCr(selector, { status: { state: "syncing" } });

    const subResourceName = this.options.kcClientSubresource;
    const subResourceClient = this.kcClient.client[subResourceName];

    try {
      const { spec } = apiObj;
      const { realm } = spec;

      const mappers = this.getMappers(spec);

      await (this.logicOverrides?.precheck ?? defaultLogicOverrides.precheck)?.({ apiObj, selector }, { kcClient: this.kcClient, logger: this.reconcilerLogger, options: this.options })

      let currentKcSubresource = await (this.logicOverrides?.findOne ?? defaultLogicOverrides.findOne)?.(mappers.findFilterFn, realm, { kcClient: this.kcClient, logger: this.reconcilerLogger, options: this.options })
      let id: string | undefined
      if (typeof currentKcSubresource === 'object' && currentKcSubresource != null && 'id' in currentKcSubresource) {
        if (typeof currentKcSubresource.id === 'string') {
          id = currentKcSubresource.id
        }
      }

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

  reconcileAllResources = async () => {
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
  };

  cleanupResources = async () => {
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
  };

  onEventHandler = async (
    _phase: string,
    apiObj: object,
  ) => {
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
  };

  startWatching = async () => {
    /* Watch client credentials custom resource */
    await watcher.watch(
      `/apis/${this.options.crdIdentifiers.group}/${this.options.crdIdentifiers.version}/${this.options.crdIdentifiers.plural}`,
      {},
      this.onEventHandler,
      async (err) => {
        this.crdHandlerLogger.error("Connection closed", err);
        this.crdHandlerLogger.info("Restarting watcher");
        await this.startWatching();
      },
    );
  };

  scheduleReconciliationJobs = async () => {
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
  };

  scheduleReconciliationJobNow = async () => {
    await this.reconciliationQueue.promoteJobs();
  };

  addReconciliationJob = async (data: ReconcilerJobData<T>) => {
    await this.reconciliationQueue.add(
      this.reconciliationJobName,
      data,
      // Give a 'new' job greater priority than a scheduled job
      {
        priority: 10,
      },
    );
  };

  scheduleCleanupJobs = async () => {
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

  scheduleCleanupJobNow = async () => {
    this.cleanupQueueLogger.log("Promoting cleanup job");
    await this.cleanupQueue.promoteJobs();
  };
}
