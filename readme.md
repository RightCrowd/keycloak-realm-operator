# Keycloak Realm Operator
A Kubernetes operator for managing resources in Keycloak; The project aims to enhance Keycloak's integration with Kubernetes and to consequently allow the definition of Keycloak resources in a (more) declarative way.

> ⚠️ This is a WIP project.

While there is a little bit of overlap with the [Keycloak Operator](https://www.keycloak.org/operator/installation), this project mostly focusses on different concerns and can perfectly be used in conjunction the Keycloak Operator (which is more focussed on the deployment of Keycloak _itself_).

# Current and future features
- [x] Sync client credentials from Keycloak to Kubernetes secrets (Implemented ✅)
- [x] Create and actively manage Keycloak realms from Kubernetes CRs (Implemented ✅)
- [x] Create and actively manage Keycloak clients from Kubernetes CRs (Implemented ✅)
- [x] Realm import which runs every reconciliation in order to cover for management of resources in Keycloak that are not yet supported by the operator. (Implemented ✅)
- [ ] Management of client scopes (Partly implemented, not documented ⏳)
- [ ] Management of users (Partly implemented, not documented ⏳)
- [ ] Management of groups (Partly implemented, not working, not documented ⏳)

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
## Realm
The operator can be used to create and manage Keycloak realms.
To accomplish this, the `KeycloakRealm` custom resource is used.

### Fields
#### realmId (required)
The ID of the realm

#### displayName (optional)
The display name of the realm

#### pruneRealm (optional)
Wether or not to delete the realm from Keycloak when the corresponding CR is deleted

#### claimRealm (optional)
Wether or not to take management of the realm if it were to already exist while not created by the operator

#### representation (optional)
An object matching the [RealmRepresentation](https://www.keycloak.org/docs-api/22.0.5/javadocs/org/keycloak/representations/idm/RealmRepresentation.html) class, dictating the configuration of the realm

#### realmImports (optional)
By specifying this field, one ore more partial realm imports are performed sequentially as part of every reconciliation loop.
This can be useful to set up resources not directly supported by the operator.

⚠️ Beware: This performs a simple Keycloak partial realm import. The operator does not 'understand' the contents of this import. This has some consequences one should be aware of:
- Depending on how it's used, this could override other assets, including configuration or resources which are actively managed by the operator.
  Example: It's perfectly possible to specify a client in the realmImport that is also defined using the KeycloakClient CR. If the `ifResourceExists` field is set to `OVERWRITE`, this would lead to an endless client update loop.
- There is no deletion mechanism. The operator does not actively manage what's specified in the the import, it simply periodically imports it. If a resource was present in the import before and is deleted afterwards, it will not be deleted by the operator.

The 'import' field should be an object matching the [PartialImportRepresentation](https://www.keycloak.org/docs-api/21.0.2/javadocs/org/keycloak/representations/idm/PartialImportRepresentation.html) class.

Example:

```yaml
realmImports:
  - ifResourceExists: OVERWRITE
    import:
      eventsListeners:
        - jboss-logging
        - metrics-listener
      roles:
        realm:
          - name: offline_access
            description: ${role_offline-access}
            composite: false
            clientRole: false
            attributes: {}
```

### Example

```yaml
apiVersion: k8s.rightcrowd.com/v1alpha1
kind: KeycloakRealm
metadata:
  name: funny-realm
spec:
  realmId: funny
  displayName: Funny Haha
  pruneRealm: true
  claimRealm: true
  representation:
    loginWithEmailAllowed: false
    registrationEmailAsUsername: true
    emailTheme: keycloak
    displayNameHtml: "<h5>Funny Realm</h5>"
```

## Client
The operator can be used to create and manage Keycloak clients.
To accomplish this, the `KeycloakClient` custom resource is used.

### Fields
#### realmId (required)
The ID of the realm

#### clientId (required)
The ID of the client

#### name (optional)
The name of the client

#### secret (optional)
By default, the client secret is generated by Keycloak. However, a secret can be provided from Kubernetes as well by specifying this field.

##### Direct specification
```yaml
  secret:
    value: supersecret123
```

##### Refering to a k8s secret
```yaml
  secret:
    valueFrom:
      secretKeyRef:
        name: the-k8s-secret-we-want-to-get-the-value-from
        namespace: the-namespace-of-that-k8s-secret
        key: secretKey
```

#### pruneClient (optional)
Wether or not to delete the client from Keycloak when the corresponding CR is deleted

#### claimClient (optional)
Wether or not to take management of the client if it were to already exist while not created by the operator

#### representation (optional)
An object matching the [ClientRepresentation](https://www.keycloak.org/docs-api/22.0.5/javadocs/org/keycloak/representations/idm/ClientRepresentation.html) class, dictating the configuration of the client

### Example

```yaml
apiVersion: k8s.rightcrowd.com/v1alpha1
kind: KeycloakClient
metadata:
  name: funny-client
spec:
  realm: funny
  clientId: funny-client
  name: Funny Client
  prune: true
  claim: true
  scopes:
    default:
      - test-scope
  representation:
    implicitFlowEnabled: true
```

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
  name: supersecret-keycloak-client-sync
spec:
  realm: funny
  clientId: funny-client
  targetSecretName: supersecret-keycloak-client-secret
  ## ⬇️ Optional
  fallbackStrategy: skip # Default is "skip". Can be set to "error" to fail the reconciliation if the client is not found in Keycloak.
  targetSecretTemplate:
    - key: realm
      template: "{{ .realm }}"
    - key: clientId
      template: "{{ .clientId }}"
    - key: clientSecret
      template: "{{ .clientSecret }}"
    - key: connectionString
      template: "https://{{ .clientId }}:{{ .clientSecret }}@funny-shop-api"
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
  realm: ZnVubnk=
  clientId: ZnVubnktY2xpZW50
  clientSecret: U2VlbXMgbGlrZSB5b3UncmUgd29ya2luZyBvbiBzb21lIGNvb2wgc3R1ZmYg8J+RgCBDaGVjayBvdXQgb3VyIGNhcmVlcnMgcGFnZSEgaHR0cHM6Ly93d3cucmlnaHRjcm93ZC5jb20vY2FyZWVycw==
  connectionString: aHR0cHM6Ly9mdW5ueS1jbGllbnQ6U2VlbXMgbGlrZSB5b3UncmUgd29ya2luZyBvbiBzb21lIGNvb2wgc3R1ZmYg8J+RgCBDaGVjayBvdXQgb3VyIGNhcmVlcnMgcGFnZSEgaHR0cHM6Ly93d3cucmlnaHRjcm93ZC5jb20vY2FyZWVyc0BmdW5ueS1zaG9wLWFwaQ==
```

# Local Development
See [Local Development](./local-development.md)