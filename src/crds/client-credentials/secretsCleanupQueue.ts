import { Queue, Worker } from 'npm:bullmq';
import { ConnectionString } from 'npm:connection-string';

import { getConfig } from '../../config.ts';
import { cleanup } from "./reconciler.ts";
import { log } from "../../util.ts";

const { hostname: host, port, password, user: username } = new ConnectionString(getConfig().REDIS_CONNECTION_STRING);

const secretCleanupQueueJobName = 'secretCleanup'
const secretCleanupQueueJobId = 'secretCleanup-job'
const secretCleanupQueueJobQueueName = 'secretCleanup-queue'

type SecretCleanupReconcilerJobData = unknown;
type SecretCleanupJobNameType = 'secretCleanup';

export const secretCleanupQueue = new Queue<SecretCleanupReconcilerJobData, unknown, SecretCleanupJobNameType>(secretCleanupQueueJobQueueName, {
  connection: {
    host,
    port,
    password,
    username,
  },
});

export const worker = new Worker<SecretCleanupReconcilerJobData, unknown, SecretCleanupJobNameType>(
    secretCleanupQueueJobQueueName,
    async (_job) => {
      try {
        log('Performing scheduled secrets cleanup')
        await cleanup();
      } catch (error) {
        console.error(error)
        throw error
      }
    },
    {
      connection: {
        host,
        port,
        password,
        username,
      },
      autorun: true
    },
);

export const scheduleJobs = async () => {
    await secretCleanupQueue.add(
        secretCleanupQueueJobName,
      {},
      {
        jobId: secretCleanupQueueJobId,
        repeat: {
          every: 60000,
        },
        removeOnComplete: {
          count: 10,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
        },
      },
    );
};

export const scheduleJobNow = async () => {
  await secretCleanupQueue.promoteJobs();
};
