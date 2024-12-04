import { env } from "node:process";
import {z} from "npm:zod";

const zConfig = z.object({
    KEYCLOAK_URL: z.string().url(),
    KEYCLOAK_USERNAME: z.string(),
    KEYCLOAK_PASSWORD: z.string()
})
  
export const getConfig = () => zConfig.parse(env)

export const validateConfig = () => {
  zConfig.parse(env)
}