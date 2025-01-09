load('ext://namespace', 'namespace_create', 'namespace_inject')
load('ext://dotenv', 'dotenv')
load('ext://helm_resource', 'helm_resource', 'helm_repo')
load('ext://k8s_attach', 'k8s_attach')
dotenv()

allow_k8s_contexts(os.getenv('TILT_K8S_CONTEXT'))

default_registry('ttl.sh')

docker_build('keycloak-realm-operator',
             context='.',
             dockerfile='./dockerfile.dev',
             live_update=[
                sync('./src', '/app/src'),
             ]
)

yaml = helm('k8s/helm', values=['localdev-helm-values.yaml'])
k8s_yaml(blob(str(yaml)))

# Example ⬇️
k8s_yaml('k8s/example/realm.yaml')
k8s_yaml('k8s/example/realm-with-import.yaml')

k8s_yaml('k8s/example/client.yaml')
k8s_yaml('k8s/example/defined-secret-client.yaml')

k8s_yaml('k8s/example/client-credential.yaml')

k8s_yaml('k8s/example/rcw-core.yaml')

k8s_resource('keycloak-realm-operator-deployment', port_forwards=[12345])
