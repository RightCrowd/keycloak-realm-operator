import z from "npm:zod";

export const zCrdSpec = z.object({
  targetSecretName: z.string(),
  keys: z.object({
    clientIdProperty: z.string().optional().default("clientId"),
    clientSecretProperty: z.string().optional().default("clientSecret"),
    realmProperty: z.string().optional().default("realm"),
  }).optional().default({
    clientIdProperty: "clientId",
    clientSecretProperty: "clientSecret",
    realmProperty: "realm",
  }),
  realm: z.string(),
  clientId: z.string(),
  fallbackStrategy: z.enum(["error", "skip"]).default("skip"),
});

export const zCrdStatusIn = z.object({
  "lastOperatorStatusUpdate": z.coerce.date().optional(),
}).optional();

export const zCrdStatusOut = z.object({
  "lastOperatorStatusUpdate": z.string().optional(),
}).optional();

export const zCustomResourceIn = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
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
