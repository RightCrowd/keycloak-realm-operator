import { z } from "npm:zod";
import {
  baseSpec,
  kcInRealmResourceCr,
  makeZCustomResourceSchema,
} from "./_utils/genericKcInRealmResourceCr.ts";

const crdSpecificSpecs = z.object({
  id: z.string(),
}).extend(baseSpec);

export const groupsCr = new kcInRealmResourceCr({
  crdIdentifiers: {
    group: "k8s.rightcrowd.com",
    version: "v1alpha1",
    plural: "keycloakgroups",
    kind: "KeycloakGroup",
  },
  kcClientSubresource: "groups",
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(crdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(crdSpecificSpecs),
  },
  idMappers: {
    find: (spec: z.infer<typeof crdSpecificSpecs>) => ({
      name: spec.id,
    }),
    create: (spec: z.infer<typeof crdSpecificSpecs>) => ({
      name: spec.id,
    }),
    update: (spec: z.infer<typeof crdSpecificSpecs>) => ({
      name: spec.id,
    }),
    humanReadable: (spec: z.infer<typeof crdSpecificSpecs>) => spec.id,
  },
});
