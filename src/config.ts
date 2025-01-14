import { env } from "node:process";
import { z } from "npm:zod";

const booleanishPreprocess = (v?: unknown) => {
  if (v == null) {
    return v;
  }
  if (typeof v === "string") {
    return v.toLowerCase() === "true";
  }
  if (typeof v === "boolean") {
    return v;
  }
  throw new Error(`Failed to parse booleanish value: ${v}`);
};

const zConfig = z.object({
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_USERNAME: z.string(),
  KEYCLOAK_PASSWORD: z.string(),
  SECRET_TARGET_NAMESPACE_STRATEGY: z.preprocess(
    (e) => typeof e === "string" ? e.toLowerCase() : e,
    z.enum([
      "skip",
      "createnamespace",
      "error",
    ]).optional().default("error"),
  )
    .describe(
      "Determines what should happen in case a k8s synced to a KC client secret is to be created in a namespace that does not exist",
    ),
  REDIS_CONNECTION_STRING: z.string().startsWith("redis://"),
  ENABLE_KUBERNETES_WATCHERS: z.preprocess(
    booleanishPreprocess,
    z.boolean().optional().default(true),
  ),
  ENABLE_WORKERS: z.preprocess(
    booleanishPreprocess,
    z.boolean().optional().default(true),
  ),
});

export const getConfig = () => zConfig.parse(env);

export const validateConfig = () => {
  zConfig.parse(env);
};
