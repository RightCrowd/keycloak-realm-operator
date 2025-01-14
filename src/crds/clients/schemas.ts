import z from "npm:zod";
import { CrSelector } from "../crd-mgmt-utils.ts";

export const zCrdSpec = z.object({
  realmId: z.string(),
  clientId: z.string(),
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
  pruneClient: z.boolean().optional().default(false).describe(
    "Wether or not to delete the client in Keycloak when the CR is deleted",
  ),
  claimClient: z.boolean().optional().default(false).describe(
    "Wether or not to claim management of the client if it were to already exist in Keycloak when the CR is created",
  ),
  // TODO: ideally we'd validate this, but that's a little much for now
  representation: z.any().describe(
    "Client representation following the ClientRepresentation spec",
  ),
});

export const zCrdStatusIn = z.object({
  state: z.enum([
    "not-synced",
    "out-of-sync",
    "syncing",
    "synced",
    "failed",
  ]).optional(),
}).optional();

export const zCrdStatusOut = z.object({
  state: z.enum([
    "not-synced",
    "out-of-sync",
    "syncing",
    "synced",
    "failed",
  ]).optional(),
}).optional();

export const zCustomResourceIn = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    uid: z.string(),
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusIn,
});

export const zCustomResourceOut = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusOut,
});

export type CustomResourceOut = z.output<typeof zCustomResourceOut>;
export type CustomResourceIn = z.output<typeof zCustomResourceIn>;

export const CUSTOMRESOURCE_GROUP = "k8s.rightcrowd.com";
export const CUSTOMRESOURCE_VERSION = "v1alpha1";
export const CUSTOMRESOURCE_PLURAL = "keycloakclients";
export const CUSTOMRESOURCE_KIND = "KeycloakClient";

export const makeSelector = (name: string): CrSelector => ({
  group: CUSTOMRESOURCE_GROUP,
  plural: CUSTOMRESOURCE_PLURAL,
  version: CUSTOMRESOURCE_VERSION,
  kind: CUSTOMRESOURCE_KIND,
  name,
});
