import { Queue, Worker } from "npm:bullmq";
import { reconcileAllResources } from "./reconciler.ts";
import { Logger } from "../../util.ts";
import { host, password, port, username } from "../../redis.ts";
import { CUSTOMRESOURCE_PLURAL } from "./schemas.ts";

const logger = new Logger("reconciliationQueue");

const jobName = `${CUSTOMRESOURCE_PLURAL}-reconciliation`;
// const jobId = `${jobName}-job`;
const jobQueueName = `${jobName}-queue`;

type SecretCleanupReconcilerJobData = unknown;
type SecretCleanupJobNameType = typeof jobName;

export const queue = new Queue<
  SecretCleanupReconcilerJobData,
  unknown,
  SecretCleanupJobNameType
>(jobQueueName, {
  connection: {
    host,
    port,
    password,
    username,
  },
});

export const worker = new Worker<
  SecretCleanupReconcilerJobData,
  unknown,
  SecretCleanupJobNameType
>(
  jobQueueName,
  async (_job) => {
    try {
      logger.log(
        `Performing scheduled ${CUSTOMRESOURCE_PLURAL} reconciliation`,
      );
      await reconcileAllResources();
      logger.log(`Finished scheduled ${CUSTOMRESOURCE_PLURAL} reconciliation`);
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
    autorun: true,
  },
);

export const scheduleJobs = async () => {
  await queue.upsertJobScheduler(
    jobName,
    { pattern: "* * * * *" },
    {
      name: jobName,
      data: {},
    },
  );
};

export const scheduleJobNow = async () => {
  await queue.promoteJobs();
};
