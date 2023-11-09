import z from "zod";
import { Env } from "./types";

export const GRAPHQL_ENDPOINT = "/:type/:identifier/:name";

export const subgraphServiceType = z.enum([
  "hosted",
  "gateway",
  "gateway-arbitrum",
  "deployment-arbitrum",
  "studio",
]);

/**
 * Cache for 5 minutes
 */
export const GLOBAL_CACHE_TTL_SECONDS = 300;

const BY_PASS_KEY = "thegraph";

export const getBypassApiKey = (identifier: string, env: Env) => {
  if (identifier === BY_PASS_KEY) {
    const key = env?.graph_api_key;
    if (!key) {
      throw new Error("Missing graph_api_key");
    }

    return key;
  }
  // If the identifier is not the bypass key, return the identifier
  return identifier;
};
