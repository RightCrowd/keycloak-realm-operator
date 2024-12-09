import { ConnectionString } from "npm:connection-string";
import { getConfig } from "./config.ts";

export const { hostname: host, port, password, user: username } =
  new ConnectionString(getConfig().REDIS_CONNECTION_STRING);
