import z from "npm:zod";

export const zCrdSpec = z.object({
  targetSecretName: z.string(),
  targetSecretTemplate: z.array(z.object({
    key: z.string(),
    template: z.string(),
  })).optional(),
  realm: z.string(),
  clientId: z.string(),
  fallbackStrategy: z.enum(["error", "skip"]).default("skip"),
});

export const zCrdStatusIn = z.object({
  "latestOperatorStatusUpdate": z.string().optional(),
}).optional();

export const zCrdStatusOut = z.object({
  "latestOperatorStatusUpdate": z.string().optional(),
}).optional();

export const zCustomResourceIn = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
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
    namespace: z.string(),
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusOut,
});
export type CustomResourceOut = z.output<typeof zCustomResourceOut>;
export type CustomResourceIn = z.output<typeof zCustomResourceIn>;

export const CUSTOMRESOURCE_GROUP = "k8s.rightcrowd.com";
export const CUSTOMRESOURCE_VERSION = "v1alpha1";
export const CUSTOMRESOURCE_PLURAL = "keycloakclientcredentials";
