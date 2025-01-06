# Local development

## Manual-setup
[Tilt](https://tilt.dev/) is used to build and deploy the the operator while performing local development. It live updates the running deployment when code changes are detected.

A cluster with Keycloak deployed in it is required.

Make sure the repo is initialized by running `./scripts/init.sh`.

> The deployment manifests (the helm chart) are housed in our [helm charts](https://github.com/RightCrowd/helm-charts/tree/main/charts/keycloak-realm-operator) repository. The init script downloads these to the `./k8s/helm` directory, from which Tilt deploys them. This allows fiddling on the manifests in a live environment locally.

Adjust the `.env` file and `localdev-helm-values.yaml` file in the root of the project as desired. These files are used by Tilt.

Make sure your kubecontext matches that of the one you want to deploy the operator locally to: `export KUBECONFIG=<path of your kubeconfig>`.

`tilt up`

## Automatically set up dev environment
A simpler, more automatic way of setting up a dev environment is available by running `./scripts/dev.sh`.

This script will use k3d to spin up a local cluster with the manifests for Keycloak deployed in it. It'll also run Tilt to deploy the operator locally. When the script is exited, everything is cleaned up automatically.

No need to adapt the example files, they should be good.

The script exposes a kubeconfig file which can be used to connect to the cluster at `k3d-localdev-cluster/kubeconfig.yaml`.

## TLDR
- Make sure [Tilt](https://tilt.dev/) and [k3d](https://k3d.io/) are installed on your machine
- `./scripts/init.sh`
- `./scripts/dev.sh`
- A local cluster is running with keycloak and the (auto-updating) operator deployed in it 🎉
  Keycloak is exposed at [http://localhost:8081](http://localhost:8081)
  To connect to the cluster: `export KUBECONFIG=$(pwd)/k3d-localdev-cluster/kubeconfig.yaml`
