// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:redis";
import { connectionString } from "../redis.ts";
import { Logger } from "../util.ts";
import { crypto } from "jsr:@std/crypto";
import { Buffer } from "node:buffer";
import { encodeHex } from "jsr:@std/encoding/hex";
import { k8sApiMC } from "../k8s.ts";
import { z } from "npm:zod";
import { k8sApiPods } from "../k8s.ts";
import { CoreV1Event } from "npm:@kubernetes/client-node";
import { getConfig } from "../config.ts";

const logger = new Logger("crd-mgmt-utils");

type CrDataType = {
  spec: any;
  status?: any;
};

export const zBasicCr = z.object({
  metadata: z.record(z.string(), z.any()),
  spec: z.record(z.string(), z.any()),
  status: z.any().optional(),
});

type ActualCRType = CrDataType & {
  metadata: {
    annotations?: {
      [key: string]: string;
    };
    [key: string]: unknown;
  };
};

const redisClient = createClient({
  url: connectionString,
})
  .on("error", (err: Error) => logger.error("Redis Client Error", err));

export const getHashingSalt = async () => {
  const redisSaltKey = "crd-mgmt:hashing-salt";
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  let salt = await redisClient.get(redisSaltKey);
  if (salt == null) {
    const newSalt = crypto.randomUUID();
    await redisClient.set(redisSaltKey, newSalt);
    salt = newSalt;
  }
  return salt;
};

export const generateDataHash = async (data: any) => {
  const salt = await getHashingSalt();
  const buf = await crypto.subtle.digest(
    "SHA-256",
    Buffer.from(JSON.stringify({
      data,
      salt,
    })),
  );
  return encodeHex(buf);
};

const generateCrHash = async (cr: CrDataType) => {
  return await generateDataHash({
    spec: cr.spec,
  });
};

const hashAnnotationKey =
  "k8s.rightcrowd.com/keycloak-realm-operator_managedhash";
export const generateCrAnnotations = async (cr: CrDataType) => {
  const hash = await generateCrHash(cr);
  return {
    [hashAnnotationKey]: hash,
  };
};

export const validateCrHash = async (cr: ActualCRType) => {
  const expectedHash = await generateCrHash(cr);
  const actualHash = cr.metadata.annotations?.[hashAnnotationKey];

  return expectedHash === actualHash;
};

export type CrSelector = {
  group: string;
  version: string;
  plural: string;
  name: string;
  namespace?: string;
  kind: string;
};

export type CrSelectorWithUid = CrSelector & {
  uid: string;
};

type CrUpdates = {
  spec?: any;
  status?: any;
};

export const generateCrUpdatePatch = async (
  selector: CrSelector,
  updates: CrUpdates,
) => {
  const namespaced = selector.namespace != null;

  const currentCr = namespaced
    ? (await k8sApiMC.getNamespacedCustomObject(
      selector.group,
      selector.version,
      selector.namespace!,
      selector.plural,
      selector.name,
    )).body as ActualCRType
    : (await k8sApiMC.getClusterCustomObject(
      selector.group,
      selector.version,
      selector.plural,
      selector.name,
    )).body as ActualCRType;

  const updatedCr: ActualCRType = {
    spec: {
      ...currentCr.spec,
      ...updates.spec,
    },
    status: {
      ...currentCr.status,
      ...updates.status,
    },
    metadata: {
      annotations: {
        // ...currentCr.metadata.annotations,
      },
    },
  };

  updatedCr.metadata.annotations = {
    ...updatedCr.metadata.annotations,
    ...(await generateCrAnnotations(updatedCr)),
  };

  const crdUpdatedStatusPatch = {
    metadata: {
      name: selector.name,
      annotations: updatedCr.metadata.annotations,
    },
    spec: updatedCr.spec,
    status: updatedCr.status,
  };

  return crdUpdatedStatusPatch;
};

export const updateCr = async <Schema extends CrUpdates = CrUpdates>(
  selector: CrSelector,
  updates: {
    spec?: Partial<Schema["spec"]>;
    status?: Partial<Schema["status"]>;
  },
) => {
  const namespaced = selector.namespace != null;

  const patch = await generateCrUpdatePatch(selector, updates);

  // const shouldPatchStatus = updates.status != null
  const shouldPatchStatus = true;

  if (shouldPatchStatus) {
    if (namespaced) {
      await k8sApiMC.patchNamespacedCustomObjectStatus(
        selector.group,
        selector.version,
        selector.namespace!,
        selector.plural,
        selector.name,
        patch,
        undefined,
        undefined,
        undefined,
        {
          headers: {
            "Content-Type": "application/merge-patch+json",
          },
        },
      );
    } else {
      await k8sApiMC.patchClusterCustomObjectStatus(
        selector.group,
        selector.version,
        selector.plural,
        selector.name,
        patch,
        undefined,
        undefined,
        undefined,
        {
          headers: {
            "Content-Type": "application/merge-patch+json",
          },
        },
      );
    }
  }

  if (namespaced) {
    await k8sApiMC.patchNamespacedCustomObject(
      selector.group,
      selector.version,
      selector.namespace!,
      selector.plural,
      selector.name,
      patch,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
      },
    );
  } else {
    await k8sApiMC.patchClusterCustomObject(
      selector.group,
      selector.version,
      selector.plural,
      selector.name,
      patch,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
      },
    );
  }
};

type Event = {
  type?: "Normal" | "Warning";
  message: string;
  reason?: string;
};

function getRandomString(s: number) {
  if (s % 2 == 1) {
    throw new Deno.errors.InvalidData("Only even sizes are supported");
  }
  const buf = new Uint8Array(s / 2);
  crypto.getRandomValues(buf);
  let ret = "";
  for (let i = 0; i < buf.length; ++i) {
    ret += ("0" + buf[i].toString(16)).slice(-2);
  }
  return ret;
}

export const logCrEvent = async (
  selector: CrSelectorWithUid,
  event: Event,
) => {
  const date = new Date(new Date().setMilliseconds(0));

  const e: CoreV1Event = {
    apiVersion: "v1",
    kind: "Event",
    metadata: {
      name: [
        selector.group,
        selector.plural,
        selector.name,
        selector.namespace,
        getRandomString(10)
      ].filter(Boolean).join("-"),
      namespace: getConfig().OPERATOR_NAMESPACE,
    },
    involvedObject: {
      apiVersion: selector.version,
      kind: selector.kind,
      name: selector.name,
      namespace: selector.namespace,
      uid: selector.uid,
    },
    type: event.type ?? "Normal",
    reason: event.reason,
    message: event.message,
    source: {
      component: "keycloak-realm-operator",
    },
    lastTimestamp: date,
    firstTimestamp: date,
    count: 1,
  };

  await k8sApiPods.createNamespacedEvent(getConfig().OPERATOR_NAMESPACE, e);
};
