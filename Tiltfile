load('ext://namespace', 'namespace_create', 'namespace_inject')
load('ext://dotenv', 'dotenv')
load('ext://helm_resource', 'helm_resource', 'helm_repo')
load('ext://k8s_attach', 'k8s_attach')
dotenv()

allow_k8s_contexts(os.getenv('TILT_K8S_CONTEXT'))

default_registry('registry.%s' % os.getenv('TILT_INGRESS_HOSTNAME'))

docker_build('operator',
             context='.',
             dockerfile='./dockerfile.dev',
             build_args={'GITLAB_API_ACCESS_TOKEN': os.getenv('GITLAB_API_ACCESS_TOKEN')},

             live_update=[
                sync('./src', '/app/src'),
             ]
)

yaml = helm('k8s/helm', values=['localdev-helm-values.yaml'])
k8s_yaml(blob(str(yaml).replace('__HOSTNAME__', str(os.getenv('TILT_INGRESS_HOSTNAME')))))

# Example ⬇️
k8s_yaml('k8s/example/realm.yaml')

k8s_resource(workload='operator-deployment', port_forwards=12345)
