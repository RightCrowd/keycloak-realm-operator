import { z } from "npm:zod";
import {
  baseSpec,
  kcInRealmResourceCr,
  makeZCustomResourceSchema,
} from "./_utils/genericKcInRealmResourceCr.ts";

const userCrdSpecificSpecs = z.object({
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string(),
}).extend(baseSpec);

export const usersCr = new kcInRealmResourceCr({
  crdIdentifiers: {
    group: "k8s.rightcrowd.com",
    version: "v1alpha1",
    plural: "keycloakusers",
    kind: "KeycloakUser",
  },
  kcClientSubresource: "users",
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(userCrdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(userCrdSpecificSpecs),
  },
  idMappers: {
    find: (spec: z.infer<typeof userCrdSpecificSpecs>) => ({
      username: spec.username,
    }),
    create: (spec: z.infer<typeof userCrdSpecificSpecs>) => ({
      email: spec.email,
      firstName: spec.firstName,
      lastName: spec.lastName,
      username: spec.username,
    }),
    update: (spec: z.infer<typeof userCrdSpecificSpecs>) => ({
      email: spec.email,
      firstName: spec.firstName,
      lastName: spec.lastName,
      username: spec.username,
    }),
    humanReadable: (spec: z.infer<typeof userCrdSpecificSpecs>) =>
      spec.username,
  },
});
