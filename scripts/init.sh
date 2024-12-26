#!/usr/bin/env bash

set -e

trap 'rm -rf -- "$tempdir"' EXIT

# Download the manifests at https://github.com/RightCrowd/helm-charts/tree/main/charts/keycloak-realm-operator to ./k8s/helm if that directory does not yet exist
if ! [[ -d "k8s/helm" ]] || ! [ -n "$(ls -A k8s/helm)" ]; then
  echo "k8s/helm does not exist or is empty, downloading..."
  rm -rf -- "k8s/helm"
  mkdir k8s/helm
  tempdir=$(mktemp -d)
  echo $tempdir
  git clone https://github.com/RightCrowd/helm-charts.git $tempdir --depth=1
  cp -R $tempdir/charts/keycloak-realm-operator/* k8s/helm
  rm -rf -- "$tempdir"
else
  echo "k8s/helm already exists. Skipping download."
fi

# Copy example env files to actual env files is those don't exist yet
[ -r .env ] && cp .env.example .env
[ -r localdev-helm-values.yaml ] && cp localdev-helm-values.example.yaml localdev-helm-values.yaml

echo "Good to go! 🚀"