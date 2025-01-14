import { Queue, Worker } from "npm:bullmq";
import { reconcileAllResources, reconcileResource } from "./reconciler.ts";
import { Logger } from "../../util.ts";
import { host, password, port, username } from "../../redis.ts";
import { CUSTOMRESOURCE_PLURAL, CustomResourceIn } from "./schemas.ts";
import { CrSelector } from "../crd-mgmt-utils.ts";
import { getConfig } from "../../config.ts";

const logger = new Logger("managed-realms:reconciliationQueue");

const jobName = `${CUSTOMRESOURCE_PLURAL}-reconciliation`;
// const jobId = `${jobName}-job`;
const jobQueueName = `${jobName}-queue`;

type ReconcilerJobData = {
  all?: boolean;
  instances?: {
    apiObj: CustomResourceIn;
    selector: CrSelector;
  }[];
};
type JobNameType = typeof jobName;

export const queue = new Queue<
  ReconcilerJobData,
  unknown,
  JobNameType
>(jobQueueName, {
  connection: {
    host,
    port,
    password,
    username,
  },
});

export const worker = new Worker<
  ReconcilerJobData,
  unknown,
  JobNameType
>(
  jobQueueName,
  async (job) => {
    if (job.data.all) {
      try {
        logger.log(
          `Reconciling all ${CUSTOMRESOURCE_PLURAL} resources`,
        );
        await reconcileAllResources();
        logger.log(
          `Finished scheduled ${CUSTOMRESOURCE_PLURAL} reconciliation`,
        );
      } catch (error) {
        console.error(error);
        throw error;
      }
    }
    if (job.data.instances != null && job.data.instances.length) {
      for (const instance of job.data.instances) {
        const { selector, apiObj } = instance;
        logger.log(
          `Reconciling ${CUSTOMRESOURCE_PLURAL} resource`,
          instance.selector,
        );
        await reconcileResource(apiObj, selector);
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

export const scheduleJobs = async () => {
  await queue.upsertJobScheduler(
    jobName,
    { pattern: "* * * * *" },
    {
      name: jobName,
      data: {
        all: true,
      },
      opts: {
        priority: 100,
      },
    },
  );
};

export const scheduleJobNow = async () => {
  await queue.promoteJobs();
};

export const addReconciliationJob = async (data: ReconcilerJobData) => {
  await queue.add(
    jobName,
    data,
    // Give a 'new' job greater priority than a scheduled job
    {
      priority: 10,
    },
  );
};
