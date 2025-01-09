import { Queue, Worker } from "npm:bullmq";
import { cleanup } from "./reconciler.ts";
import { Logger } from "../../util.ts";
import { host, password, port, username } from "../../redis.ts";
import { CUSTOMRESOURCE_PLURAL } from "./schemas.ts";

const logger = new Logger("managed-realms:cleanupQueue");

const jobName = `${CUSTOMRESOURCE_PLURAL}-cleanup`;
// const jobId = `${jobName}-job`;
const jobQueueName = `${jobName}-queue`;

type ReconcilerJobData = unknown;
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
  async (_job) => {
    try {
      logger.log(
        `Performing scheduled ${CUSTOMRESOURCE_PLURAL} cleanup`,
      );
      await cleanup();
      logger.log(`Finished scheduled ${CUSTOMRESOURCE_PLURAL} cleanup`);
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
  logger.log("Promoting cleanup job");
  await queue.promoteJobs();
};
