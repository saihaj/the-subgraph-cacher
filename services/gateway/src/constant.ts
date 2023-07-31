import z from "zod";

export const GRAPHQL_ENDPOINT = "/:type/:identifier/:name";

export const subgraphServiceType = z.enum(["hosted", "gateway", "studio"]);

/**
 * Cache for 5 minutes
 */
export const GLOBAL_CACHE_TTL_SECONDS = 300;
