import * as k8s from "npm:@kubernetes/client-node";
import { z } from "npm:zod";
import { CUSTOMRESOURCE_GROUP, CUSTOMRESOURCE_PLURAL, CUSTOMRESOURCE_VERSION, log } from "./util.ts";
import process from "node:process";
import { handleK8sResourceDeletion, handleK8sResourceUpdate, handleK8sResourceCreation } from "./reconciler.ts";

const zCrdSpec = z.object({
  realmId: z.string(),
  displayName: z.string().optional(),
  pruneRealm: z.boolean().optional(),
  clients: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['oidc']),
    clientAuthenticationEnabled: z.boolean().optional(),
    secretTargets: z.array(z.object({
      namespace: z.string(),
      name: z.string(),
      clientIdPropertyName: z.string().optional().default('clientId'),
      clientSecretPropertyName: z.string().optional().default('clientSecret')
    })).optional()
  })).optional()
})

export const zCrdStatusIn = z.object({
  'lastOperatorStatusUpdate': z.coerce.date().optional()
}).optional()

export const zCrdStatusOut = z.object({
  'lastOperatorStatusUpdate': z.string().optional()
}).optional()

export const zCustomResourceIn = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string()
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusIn
})

export const zCustomResourceOut = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string()
  }).passthrough(),
  spec: zCrdSpec,
  status: zCrdStatusOut
})

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
kc.loadFromCluster();

// const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
const k8sApiMC = kc.makeApiClient(k8s.CustomObjectsApi);
// const k8sApiPods = kc.makeApiClient(k8s.CoreV1Api);

async function onEvent(phase: string, apiObj: z.output<typeof zCustomResourceIn>) {
  const status = zCrdStatusIn.parse(apiObj.status)
  if (phase == "ADDED") {
    await handleK8sResourceCreation(apiObj.metadata.name, apiObj);
  } else if (phase == "MODIFIED") {
    // TODO: we can probably do something more clever ⬇️
    // If the operator updated the resource less than 500ms ago, the incoming update might simply be our own update. Let's ignore it
    if (status?.lastOperatorStatusUpdate != null && ((new Date().getTime() - new Date(status.lastOperatorStatusUpdate).getTime()) < 500)) {
      log(`Ignoring own update`)
      return
    }
    await handleK8sResourceUpdate(apiObj.metadata.name, apiObj);
  } else if (phase == "DELETED") {
    await handleK8sResourceDeletion(apiObj.metadata.name!, apiObj)
  } else {
    log(`Unknown event type: ${phase}`);
  }
}

export async function updateStatus(k8sResourceName: string, status: z.input<typeof zCrdStatusOut>) {
  const resourceFetch = await k8sApiMC.getClusterCustomObject(
    CUSTOMRESOURCE_GROUP,
    CUSTOMRESOURCE_VERSION,
    CUSTOMRESOURCE_PLURAL,
    k8sResourceName,
  )
  const currentObj = zCustomResourceIn.parse(resourceFetch.body)

  const crdUpdatedStatusPatch = {
    apiVersion: currentObj.apiVersion,
    kind: currentObj.kind,
    metadata: {
      name: currentObj.metadata.name
    },
    status: zCrdStatusOut.parse({
      lastOperatorStatusUpdate: new Date().toISOString(),
      ...status
    })
  };

  try {
    await k8sApiMC.patchClusterCustomObject(
      CUSTOMRESOURCE_GROUP,
      CUSTOMRESOURCE_VERSION,
      CUSTOMRESOURCE_PLURAL,
      k8sResourceName,
      crdUpdatedStatusPatch,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          'Content-Type': 'application/merge-patch+json'
        }
      }
    );
  } catch (error) {
    log('Failed to update cr status');
    throw error;
  }
}

export async function startWatching() {
  await new k8s.Watch(kc).watch(
    `/apis/${CUSTOMRESOURCE_GROUP}/${CUSTOMRESOURCE_VERSION}/${CUSTOMRESOURCE_PLURAL}`,
    {},
    onEvent,
    (err) => {
      log(`Connection closed. ${err}`);
      process.exit(1);
    },
  );
}
