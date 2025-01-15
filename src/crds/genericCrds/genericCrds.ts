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
    plural: "clientscopes",
    kind: "ClientScope",
  },
  kcClientSubresource: "clientScopes",
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(crdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(crdSpecificSpecs),
  },
});

const groupsCr = new kcInRealmResourceCr({
  crdIdentifiers: {
    group: "k8s.rightcrowd.com",
    version: "v1alpha1",
    plural: "groups",
    kind: "Group",
  },
  kcClientSubresource: "groups",
  validationSchemas: {
    customResourceIn: makeZCustomResourceSchema(crdSpecificSpecs),
    customResourceOut: makeZCustomResourceSchema(crdSpecificSpecs),
  },
});

export const genericCrds = [
  clientScopesCr,
  groupsCr
]