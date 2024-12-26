# Keycloak Realm Operator
A Kubernetes operator for managing resources in Keycloak; The project aims to enhance Keycloak's integration with Kubernetes and to consequently allow the definition of Keycloak resources in a (more) declarative way.

> ⚠️ This is a WIP project.

While there is a little bit of overlap with the [Keycloak Operator](https://www.keycloak.org/operator/installation), it mostly focusses on different concerns and can perfectly be used in conjunction with it.

# Current and future features
- [x] Sync client credentials from Keycloak to Kubernetes secrets (Implemented ✅)
- [ ] Create and actively manage Keycloak realms from Kubernetes CRs (In progress ⏳)
- [ ] Create and actively manage Keycloak clients from Kubernetes CRs (Planned 🔜)

# Installation with Helm
```sh
helm repo add rightcrowd https://rightcrowd.github.io/helm-charts
helm repo update
helm install keycloak-realm-operator rightcrowd/keycloak-realm-operator
```

Example values file:

```yaml
keycloak:
  url: https://keycloak.thecakeshop.com
  username:
    valueFrom:
      secretKeyRef:
        name: keycloak-admin-credentials
        key: username
  password:
    valueFrom:
      secretKeyRef:
        name: keycloak-admin-credentials
        key: password
```

# Usage
## Client credential sync
The operator can be used to sync Keycloak client credentials to Kubernetes secrets.
To accomplish this, the `KeycloakClientCredential` custom resource is used.

### Example
The example below syncs the credentials for Keycloak client `that-one-client` in realm `rightcrowd-core` to Kubernetes secret `supersecret-keycloak-client-secret`.
The `KeycloakClientCredential` is to be deployed in the namespace where the related secret should be created.

```yaml
apiVersion: k8s.rightcrowd.com/v1alpha1
kind: KeycloakClientCredential
metadata:
  name: supersecret-cake-shop-credentials-sync
  namespace: cake-shop
spec:
  realm: foodies
  clientId: cake-shop-api-client
  targetSecretName: supersecret-cake-shop-credentials
  ## ⬇️ Optional
  # clientIdProperty: clientId
  # clientSecretProperty: clientSecret
  # realmProperty: realm
```

Based on this definition, the operator will fetch the credentials from Keycloak and create a  Kubernetes secret looking as follows:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: supersecret-cake-shop-credentials
  namespace: cake-shop
type: Opaque
data:
  realm: Zm9vZGllcw==
  clientId: Y2FrZS1zaG9wLWFwaS1jbGllbnQ=
  clientSecret: U2VlbXMgbGlrZSB5b3UncmUgd29ya2luZyBvbiBzb21lIGNvb2wgc3R1ZmYg8J+RgCBDaGVjayBvdXQgb3VyIGNhcmVlcnMgcGFnZSEgaHR0cHM6Ly93d3cucmlnaHRjcm93ZC5jb20vY2FyZWVycw==
```

# Local Development
- Make sure [Tilt](https://tilt.dev/) is installed on your machine
- Prepare the repo by running `./scripts/init.sh`
  > The deployment manifests (the helm chart) are housed in our [helm charts](https://github.com/RightCrowd/helm-charts/tree/main/charts/keycloak-realm-operator) repository. The init script downloads these to the `./k8s/helm` directory, from which Tilt deploys them. This allows fiddling on the manifests in a live environment locally.
- Run the [RightCrowd localdev cluster](https://gitlab.com/rightcrowd/platform-infra/-/tree/main/clusters?ref_type=heads)
    > Note: The RightCrowd localdev cluster is an internal development tool which is not public.
    > That being said, all you essentially need for the operator to work locally is a running Kubernetes cluster with (network accessible) Keycloak in it.

- Create a `.env` file and a `localdev-helm-values.yaml` file in the root of this project based on the example files
- `export KUBECONFIG=<path of your kubeconfig>`
- `tilt up`
