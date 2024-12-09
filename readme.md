# Kubernetes Keycloak realm operator
This project started (and still is) some personal spielerei by [Evert](https://gitlab.com/evert.despiegeleer) with the following goals (in descending order of importance):
- Learn about [Deno](https://deno.com/)
- Learn about [distroless container images](https://github.com/GoogleContainerTools/distroless)
- Learn about Kubernetes custom resources and operators

I needed something to apply this all to. The drift of Keycloak realms in our cluster due to the lacking realm-management capabilities of the [Keycloak Operator](https://www.keycloak.org/operator/installation), and the fact that we have to manually sync secrets between Keycloak and other components in our cluster had been bugging me for a while. So I decided that if I had to build something, I may as well try and fix this problem.

⚠️ This project is a WIP and is nowhere near usable, it isn't actually being used anywhere.

## Aim
- Create, update and deleted (CUD) Keycloak realms and their configurations via Kubernetes resources.
- CUD clients in these realms
- Sync Keycloak client credentials (clientIds and clientSecrets) back into Kubernetes secrets

## Current status
- [x] Create and delete realms based on a custom Kubernetes resource (`managedkeycloakrealms.k8s.rightcrowd.com`)
- [x] K8s secrets can be created and updated based on Keycloak secrets
- [x] Managed k8s secrets can be deleted when the related custom resource is deleted
- [x] Every minute, a reconciliation loop and a cleanup loop run for the client-credentials custom resource (`keycloakclientcredentials.k8s.rightcrowd.com`)
- [x] client-credentials CR fallbackStrategy is taken into account

## Local Development
- Run the [RightCrowd localdev cluster](https://gitlab.com/rightcrowd/platform-infra/-/tree/main/clusters?ref_type=heads).
- Create a `.env` file and a `localdev-helm-values.yaml` file in the root of this project based on the example files.
- `export KUBECONFIG=<path of your kubeconfig>`
- `tilt up`

## Build operator container
`docker build -t keycloak-realm-operator .`

## Usage
Deploy using Helm. Minimal example values file:
```yaml
keycloak:
  url: https://iam.rightcrowd.dev
  username:
    valueFrom:
      secretKeyRef:
        name: keycloak-admin-secret
        key: username
  password:
    valueFrom:
      secretKeyRef:
        name: keycloak-admin-secret
        key: password
```

## Notes
- Only the `keycloakclientcredentials.k8s.rightcrowd.com` is currently being used. `managedkeycloakrealms.k8s.rightcrowd.com` isn't yet reliable and is commented out.