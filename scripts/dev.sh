#!/usr/bin/env bash

set -e

CLUSTER_NAME="keycloak-realm-operator-localdev"
trap 'tilt down && k3d cluster delete $CLUSTER_NAME' EXIT

# Delete the cluster if it were to still exist
k3d cluster delete $CLUSTER_NAME || true

k3d cluster create $CLUSTER_NAME --volume $(pwd)/k3d-localdev-cluster/manifests:/var/lib/rancher/k3s/server/manifests --wait --api-port 6550 -p "8081:8080@loadbalancer"
k3d kubeconfig get $CLUSTER_NAME > $(pwd)/k3d-localdev-cluster/kubeconfig.yaml

export KUBECONFIG=$(pwd)/k3d-localdev-cluster/kubeconfig.yaml

echo "🚀 Cluster '$CLUSTER_NAME' created, ctrl+c to shut it down"
echo "🤖 Starting Tilt for development"

tilt up

# Keep script running until interupt
while true; do sleep 1000; done