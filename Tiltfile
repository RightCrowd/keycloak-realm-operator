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

# Bullboard (dev tool) ⬇️
k8s_yaml('k8s/bullboard.yaml')

# Example ⬇️
# k8s_yaml('k8s/example/*')

k8s_yaml(local('for each in ./k8s/example/*.yaml; do cat $each; echo "\n---"; done'))

k8s_resource('keycloak-realm-operator-deployment', port_forwards=[12345])
k8s_resource('bullboard-deployment', port_forwards=[3000])
