// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:redis";
import { connectionString } from "../redis.ts";
import { Logger } from "../util.ts";
import { crypto } from "jsr:@std/crypto";
import { Buffer } from "node:buffer";
import { encodeHex } from "jsr:@std/encoding/hex";

const logger = new Logger("crd-mgmt-utils");

type CrDataType = {
    spec: any;
    status?: any;
}

type ActualCRType = CrDataType & {
    metadata: {
        annotations?: {
            [key: string]: string;
        }
    }
}

const redisClient = createClient({
    url: connectionString,
})
.on('error', (err: Error) => logger.error('Redis Client Error', err));

export const getHashingSalt = async () => {
    const redisSaltKey = 'crd-mgmt:hashing-salt'
    if (!redisClient.isReady) {
        await redisClient.connect();
    }
    let salt = await redisClient.get(redisSaltKey)
    if (salt == null) {
        const newSalt = crypto.randomUUID();
        await redisClient.set(redisSaltKey, newSalt);
        salt = newSalt;
    }
    return salt;
};

const generateCrHash = async (cr: CrDataType) => {
    const salt = await getHashingSalt();
    const buf = await crypto.subtle.digest("SHA-256", Buffer.from(JSON.stringify({
        spec: cr.spec,
        status: cr.status,
        salt
    })))
    return encodeHex(buf)
}

const hashAnnotationKey = 'k8s.rightcrowd.com/keycloak-realm-operator/managed-hash'
export const generateCrAnnotations = async (cr: CrDataType) => {
    const hash = await generateCrHash(cr);
    return {
        [hashAnnotationKey]: hash,
    }
}

export const validateCrHash = async (cr: ActualCRType) => {
    const expectedHash = await generateCrHash(cr);
    const actualHash = cr.metadata.annotations?.[hashAnnotationKey];

    return expectedHash === actualHash;
}