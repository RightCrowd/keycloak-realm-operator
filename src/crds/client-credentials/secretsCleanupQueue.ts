import { Queue, Worker } from "npm:bullmq";
import { cleanup } from "./reconciler.ts";
import { log } from "../../util.ts";
import { host, password, port, username } from "../../redis.ts";

const jobName = "secretCleanup";
const jobId = `${jobName}-job`;
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
      log("Performing scheduled secrets cleanup");
      await cleanup();
      log("Finished scheduled secrets cleanup");
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
  await queue.add(
    jobName,
    {},
    {
      jobId,
      repeat: {
        every: 60000,
      },
    },
  );
};

export const scheduleJobNow = async () => {
  await queue.promoteJobs();
};
