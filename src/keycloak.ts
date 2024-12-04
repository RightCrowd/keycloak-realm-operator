import KcAdminClient from 'npm:@keycloak/keycloak-admin-client';
import { jwtDecode } from "npm:jwt-decode";
import { getConfig } from './config.ts';
import { log } from "./util.ts";

type RealmRepresentation = NonNullable<Awaited<ReturnType<InstanceType<typeof KcAdminClient>['realms']['findOne']>>>

const isManagedRealm = (realm: RealmRepresentation) => {
    return realm.attributes?.['rcw-keycloak-realm-operator-managed'] === 'true'
}

const throwIfNotManaged = (realm: RealmRepresentation) => {
    if (!isManagedRealm(realm)) {
        throw new Error(`Realm with id ${realm.realm} is not managed`)
    }
}

export class KeycloakClient {
    public client = new KcAdminClient({
        baseUrl: getConfig().KEYCLOAK_URL,
        realmName: 'master',
    })

    private async autheticate(refreshToken?: string) {
        try {
            await this.client.auth({
                username: getConfig().KEYCLOAK_USERNAME,
                password: getConfig().KEYCLOAK_PASSWORD,
                grantType: 'password',
                clientId: 'admin-cli',
                refreshToken
            });
        } catch (error) {
            log('Failed to authenticate with Keycloak')
            throw error;
        }
    }

    private async ensureAuthed() {
        if (this.client.accessToken == null) {
            log('Authenticating against KC')
            await this.autheticate()
            return
        }
        const accessToken = this.client.accessToken!;
        const expirationDate = new Date(jwtDecode(accessToken).exp!)
        if (new Date().getTime() > expirationDate.getTime() - 5 * 60 * 1000) {
            log('Refreshing KC token')
            await this.autheticate(this.client.refreshToken)
        }
    }

    private async kcApiRetryWrapper <T>(promise: Promise<T>) {
        let attempts = 0;
        while (true) {
            try {
                return await promise
            } catch(error) {
                if (error instanceof Error && error.message === 'unknown_error') {
                    if (++attempts > 10) {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
        }
    };

    private async getRealms () {
        await this.ensureAuthed()
        return await this.client.realms.find();
    }

    async getManagedRealms () {
        const realms = await this.getRealms();

        return realms.filter(isManagedRealm)
    }

    async getRealmById (id: string) {
        await this.ensureAuthed()
        const realm = await this.client.realms.findOne({ realm: id });
        return realm
    }

    async getRealmByIdOrThrow (id: string) {
        const realm = await this.getRealmById(id);
        if (realm == null) {
            throw new Error(`Realm with id ${id} does not exist`)
        }
        return realm
    }

    async createRealm (id: string) {
        await this.ensureAuthed()
        const exisingRealm = await this.client.realms.findOne({ realm: id });
        if (exisingRealm != null) {
            throw new Error(`Realm with id ${id} already exists`)
        }
        await this.client.realms.create({
            // id,
            realm: id,
            attributes: {
                'rcw-keycloak-realm-operator-managed': 'true'
            }
        })
    }

    async markRealmUnmanaged (id: string) {
        await this.ensureAuthed()
        const realm = await this.getRealmByIdOrThrow(id);
        throwIfNotManaged(realm)
        await this.client.realms.update({
            realm: id
        }, {
            attributes: {
                'rcw-keycloak-realm-operator-managed': 'false'
            }
        })
    }

    async deleteRealm (id: string) {
        await this.ensureAuthed()
        const realm = await this.getRealmByIdOrThrow(id)
        throwIfNotManaged(realm)
        await this.client.realms.del({ realm: id })
        log(`Deleted realm with id ${id}`)
    }
}