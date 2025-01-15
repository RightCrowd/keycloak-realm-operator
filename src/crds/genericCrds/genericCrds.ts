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
  defaultAttributes: {
    "display.on.consent.screen": "true",
    "consent.screen.text": "",
    "include.in.token.scope": false,
    "gui.order": "",
  },
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

const userCrdSpecificSpecs = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string().optional()
})

const usersCr = new kcInRealmResourceCr({
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
      email: spec.email,
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
    humanReadable: (spec: z.infer<typeof userCrdSpecificSpecs>) => spec.email,
  },
});

export const genericCrds = [
  clientScopesCr,
  groupsCr,
  usersCr
];
