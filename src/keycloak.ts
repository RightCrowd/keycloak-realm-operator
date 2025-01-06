import KcAdminClient from "npm:@keycloak/keycloak-admin-client";
import { jwtDecode } from "npm:jwt-decode";
import { getConfig } from "./config.ts";
import { Logger } from "./util.ts";

const logger = new Logger("keycloak");

const managedAttributeName = "rcw-keycloak-realm-operator-managed";

export type RealmRepresentation = NonNullable<
  Awaited<ReturnType<InstanceType<typeof KcAdminClient>["realms"]["findOne"]>>
>;

export type ClientRepresentation = NonNullable<
  RealmRepresentation["clients"]
>[number];

const isManagedRealm = (realm: RealmRepresentation) => {
  return realm.attributes?.[managedAttributeName] === "true";
};

const isManagedClient = (client: ClientRepresentation) => {
  return client.attributes?.[managedAttributeName] === "true";
};

const throwIfNotManaged = (realm: RealmRepresentation) => {
  if (!isManagedRealm(realm)) {
    throw new Error(`Realm with id ${realm.realm} is not managed`);
  }
};

const throwIfNotManagedClient = (client: ClientRepresentation) => {
  if (!isManagedClient(client)) {
    throw new Error(`Client with id ${client.id} is not managed`);
  }
};

export class KeycloakClient {
  public client = new KcAdminClient({
    baseUrl: getConfig().KEYCLOAK_URL,
    realmName: "master",
  });

  private async autheticate(refreshToken?: string) {
    try {
      await this.client.auth({
        username: getConfig().KEYCLOAK_USERNAME,
        password: getConfig().KEYCLOAK_PASSWORD,
        grantType: "password",
        clientId: "admin-cli",
        refreshToken,
      });
    } catch (error) {
      logger.log("Failed to authenticate with Keycloak");
      throw error;
    }
  }

  async ensureAuthed() {
    if (this.client.accessToken == null) {
      logger.log("Authenticating against KC");
      await this.autheticate();
      return;
    }
    const accessToken = this.client.accessToken!;
    const expirationDate = new Date(jwtDecode(accessToken).exp!);
    if (new Date().getTime() > expirationDate.getTime() - 5 * 60 * 1000) {
      logger.log("Refreshing KC token");
      await this.autheticate(this.client.refreshToken);
    }
  }

  private async kcApiRetryWrapper<T>(promise: Promise<T>) {
    let attempts = 0;
    while (true) {
      try {
        return await promise;
      } catch (error) {
        if (error instanceof Error && error.message === "unknown_error") {
          if (++attempts > 10) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }
  }

  private async getRealms() {
    await this.ensureAuthed();
    return await this.client.realms.find();
  }

  async getManagedRealms() {
    const realms = await this.getRealms();

    return realms.filter(isManagedRealm);
  }

  async getRealmById(id: string) {
    await this.ensureAuthed();
    const realm = await this.client.realms.findOne({ realm: id });
    return realm;
  }

  async getRealmByIdOrThrow(id: string) {
    const realm = await this.getRealmById(id);
    if (realm == null) {
      throw new Error(`Realm with id ${id} does not exist`);
    }
    return realm;
  }

  async createRealm(id: string) {
    await this.ensureAuthed();
    const exisingRealm = await this.client.realms.findOne({ realm: id });
    if (exisingRealm != null) {
      throw new Error(`Realm with id ${id} already exists`);
    }
    const attributes: Record<string, string> = {};
    attributes[managedAttributeName] = "true";
    await this.client.realms.create({
      // id,
      realm: id,
      attributes,
    });
  }

  async markRealmUnmanaged(id: string) {
    await this.ensureAuthed();
    const realm = await this.getRealmByIdOrThrow(id);
    throwIfNotManaged(realm);
    const attributes: Record<string, string> = {};
    attributes[managedAttributeName] = "false";
    await this.client.realms.update({
      realm: id,
    }, {
      attributes,
    });
  }

  async deleteRealm(id: string) {
    await this.ensureAuthed();
    const realm = await this.getRealmByIdOrThrow(id);
    throwIfNotManaged(realm);
    await this.client.realms.del({ realm: id });
    logger.log(`Deleted realm with id ${id}`);
  }

  async getRealmManagedClients(realmId: string) {
    await this.ensureAuthed();
    const realm = await this.getRealmByIdOrThrow(realmId);
    return (realm.clients ?? []).filter(isManagedClient);
  }

  async getRealmClientByClientIdOrThrow(realmId: string, clientId: string) {
    await this.ensureAuthed();
    const clients = await this.client.clients.find({
      realm: realmId,
    });
    const client = clients.find((c) => c.clientId === clientId);
    if (client == null) {
      throw new Error(
        `Client with id ${clientId} in realm ${realmId} does not exist`,
      );
    }
    return client;
  }

  async getRealmClientByIdOrThrow(realmId: string, clientId: string) {
    await this.ensureAuthed();
    const client = await this.client.clients.findOne({
      id: clientId,
      realm: realmId,
    });
    if (client == null) {
      throw new Error(
        `Client with id ${clientId} in realm ${realmId} does not exist`,
      );
    }
    return client;
  }

  async createClient(realmId: string, client: ClientRepresentation) {
    await this.ensureAuthed();
    await this.getRealmByIdOrThrow(realmId);
    const attributes: Record<string, string> = {};
    attributes[managedAttributeName] = "true";
    await this.client.clients.create({
      realm: realmId,
      ...client,
      attributes,
    });
  }

  async updateClient(
    realmId: string,
    clientId: string,
    clientDetails: ClientRepresentation,
  ) {
    await this.ensureAuthed();
    await this.getRealmByIdOrThrow(realmId);
    const currentClient = await this.getRealmClientByIdOrThrow(
      realmId,
      clientId,
    );
    throwIfNotManagedClient(currentClient);
    await this.client.clients.update({
      id: clientId,
      realm: realmId,
    }, clientDetails);
  }
}
