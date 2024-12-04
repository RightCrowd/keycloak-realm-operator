export function log(message: string) {
    console.log(`${new Date().toLocaleString()}: ${message}`);
}

export const CUSTOMRESOURCE_GROUP = "k8s.rightcrowd.com";
export const CUSTOMRESOURCE_VERSION = "v1alpha1";
export const CUSTOMRESOURCE_PLURAL = "managedkeycloakrealms";