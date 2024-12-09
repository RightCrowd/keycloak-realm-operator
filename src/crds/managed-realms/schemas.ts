import z from "npm:zod";

export const zCrdSpec = z.object({
  realmId: z.string(),
  displayName: z.string().optional(),
  pruneRealm: z.boolean().optional(),
  clients: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["oidc"]),
    clientAuthenticationEnabled: z.boolean().optional(),
    secretTargets: z.array(z.object({
      namespace: z.string(),
      name: z.string(),
      clientIdPropertyName: z.string().optional().default("clientId"),
      clientSecretPropertyName: z.string().optional().default(
        "clientSecret",
      ),
    })).optional(),
  })).optional(),
});

export const zCrdStatusIn = z.object({
  "latestOperatorStatusUpdate": z.coerce.date().optional(),
}).optional();

export const zCrdStatusOut = z.object({
  "latestOperatorStatusUpdate": z.string().optional(),
}).optional();

export const zCustomResourceIn = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusIn,
});

export const zCustomResourceOut = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusOut,
});

export const CUSTOMRESOURCE_GROUP = "k8s.rightcrowd.com";
export const CUSTOMRESOURCE_VERSION = "v1alpha1";
export const CUSTOMRESOURCE_PLURAL = "managedkeycloakrealms";
