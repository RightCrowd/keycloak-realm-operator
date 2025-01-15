import { z } from "npm:zod";
import {
  kcInRealmResourceCr,
  makeZCustomResourceSchema,
} from "../genericKcInRealmResourceCr.ts";

const crdSpecificSpecs = z.object({
  id: z.string(),
});

const clientScopesCr = new kcInRealmResourceCr({
  crdIdentifiers: {
    group: "k8s.rightcrowd.com",
    version: "v1alpha1",
    plural: "keycloakclientscopes",
    kind: "KeycloakClientScope",
  },
  kcClientSubresource: "clientScopes",
  defaultAttributes: 
    {
      "display.on.consent.screen": "true",
      "consent.screen.text": "",
      "include.in.token.scope": false,
      "gui.order": ""
    },
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(crdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(crdSpecificSpecs),
  },
  idMappers: {
    find: (spec: z.infer<typeof crdSpecificSpecs>) => ({
      name: spec.id
    }),
    create: (spec: z.infer<typeof crdSpecificSpecs>) => ({
      name: spec.id
    }),
    humanReadable: (spec: z.infer<typeof crdSpecificSpecs>) => spec.id
  }
});

const groupsCr = new kcInRealmResourceCr({
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
      name: spec.id
    }),
    create: (spec: z.infer<typeof crdSpecificSpecs>) => ({
      name: spec.id
    }),
    humanReadable: (spec: z.infer<typeof crdSpecificSpecs>) => spec.id
  }
});

export const genericCrds = [
  clientScopesCr,
  groupsCr
]