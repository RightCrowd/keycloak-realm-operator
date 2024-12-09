import * as k8s from "npm:@kubernetes/client-node";

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
kc.loadFromCluster();

export const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
export const k8sApiMC = kc.makeApiClient(k8s.CustomObjectsApi);
export const k8sApiPods = kc.makeApiClient(k8s.CoreV1Api);

export const watcher = new k8s.Watch(kc);
