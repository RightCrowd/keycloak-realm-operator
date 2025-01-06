# Keycloak Realm Operator
A Kubernetes operator for managing resources in Keycloak; The project aims to enhance Keycloak's integration with Kubernetes and to consequently allow the definition of Keycloak resources in a (more) declarative way.

> ⚠️ This is a WIP project.

While there is a little bit of overlap with the [Keycloak Operator](https://www.keycloak.org/operator/installation), this project mostly focusses on different concerns and can perfectly be used in conjunction the Keycloak Operator (which is more focussed on the deployment of Keycloak _itself_).

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

### Fields
#### realm (required)
#### clientId (required)
#### targetSecretName (required)
The name of the Kubernetes secret where the client credentials should be stored. The secret will be created in the same namespace as the `KeycloakClientCredential` resource.

#### targetSecretTemplate (optional)
The data of the secret can be sculpted using the optional `targetSecretTemplate` field, which accepts golang template syntax. If the `targetSecretTemplate` field is not provided, the following template will be used:
```yaml
  - key: realm
    template: {{ .realm }}
  - key: clientId
    template: {{ .clientId }}
  - key: clientSecret
    template: {{ .clientSecret }}
```

#### fallbackStrategy (optional)
The `fallbackStrategy` field can be used to control the behaviour of the operator when the client is not found in Keycloak. The following values are supported:
* `error`: The operator will fail when the client is not found in Keycloak.
* `skip`: The operator will skip the reconciliation when the client is not found in Keycloak. This is the default value.

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
  fallbackStrategy: skip # Default is "skip". Can be set to "error" to fail the reconciliation if the client is not found in Keycloak.
  targetSecretTemplate:
    - key: realm
      template: {{ .realm }}
    - key: clientId
      template: {{ .clientId }}
    - key: clientSecret
      template: {{ .clientSecret }}
    - key: connectionString
      template: "https://{{ .clientId }}:{{ .clientSecret }}@cake-shop-api"
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
  connectionString: aHR0cHM6Ly9jYWtlLXNob3AtYXBpLWNsaWVudDpTZWVtcyBsaWtlIHlvdSdyZSB3b3JraW5nIG9uIHNvbWUgY29vbCBzdHVmZiDwn5GAIENoZWNrIG91dCBvdXIgY2FyZWVycyBwYWdlISBodHRwczovL3d3dy5yaWdodGNyb3dkLmNvbS9jYXJlZXJzQGNha2Utc2hvcC1hcGk=
```

# Local Development
See [Local Development](./local-development.md)