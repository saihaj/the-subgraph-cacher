import { Plugin } from "graphql-yoga";
import { normalizeOperation } from "@graphql-hive/core";
import { CfRequest, Env } from "./types";
import { INTROSPECTION_QUERY } from "./introspection-query";
import {
  GLOBAL_CACHE_TTL_SECONDS,
  GRAPHQL_ENDPOINT,
  subgraphServiceType,
} from "./constant";
import { Analytics } from "./analytics";
import type { Logger } from "workers-loki-logger";
import { z } from "zod";

/**
 * It is a safe assumption that we skip validation on this gateway
 * we are just caching data here. If we don't have data
 * we will pass through to the remote executor and remote validates it.
 */
export const skipValidate: Plugin = {
  onValidate({ setResult }) {
    setResult([]);
  },
};

type CacheData = {
  operation: string;
  endpoint: string;
  data: string;
  variables: Record<string, any>;
};

const cacheStore = (env: Env, ttl: number) => {
  return {
    async get(key: string) {
      const data = await env.v1_cache_the_graph.get<CacheData>(key, "json");

      if (!data) {
        return null;
      }

      return data;
    },
    async set(key: string, data: CacheData) {
      await env.v1_cache_the_graph.put(key, JSON.stringify(data), {
        expirationTtl: ttl,
      });
    },
  };
};

async function createHashKey({
  variables,
  normalizedOp,
  type,
  name,
  identifier,
}: {
  normalizedOp: string;
  variables: string;
  type: z.infer<typeof subgraphServiceType>;
  name: string;
  identifier: string;
}) {
  const serviceKeyPrefix =
    /**
     * Gateway keys were being too big
     *
     * We don't need users's API key part of the key. All other cache keys are also just caching subgraph
     * and are not namespaced by user's usage. Our analytics will still be able to track usage by user's key
     */
    type === "gateway" || type === "gateway-arbitrum"
      ? `${type}:${name}`
      : `${type}:${identifier}:${name}`;
  const encode = new TextEncoder().encode(
    JSON.stringify({ variables, normalizedOp })
  );
  const encrypted = await crypto.subtle.digest("md5", encode);

  return `${serviceKeyPrefix}//${[...new Uint8Array(encrypted)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

const urlPattern = new URLPattern({
  pathname: GRAPHQL_ENDPOINT,
});

const getHostedServiceUrl = ({
  username,
  subgraphName,
}: {
  username: string;
  subgraphName: string;
}) => `https://api.thegraph.com/subgraphs/name/${username}/${subgraphName}`;

const getStudioUrl = ({
  subgraphName,
  studioUserNumber,
}: {
  studioUserNumber: string;
  subgraphName: string;
}) =>
  `https://api.studio.thegraph.com/query/${studioUserNumber}/${subgraphName}/version/latest`;

const getGatewayUrl = ({
  apiKey,
  subgraphId,
}: {
  apiKey: string;
  subgraphId: string;
}) => `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;

const getArbitrumGatewayUrl = ({
  apiKey,
  subgraphId,
}: {
  apiKey: string;
  subgraphId: string;
}) =>
  `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;

const getArbitrumDeploymentUrl = ({
  apiKey,
  deploymentId,
}: {
  apiKey: string;
  deploymentId: string;
}) =>
  `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/deployments/id/${deploymentId}`;

export const remoteExecutor: Plugin<{
  env: Env;
  analytics: Analytics;
  logger: Logger;
}> = {
  async onExecute({ args, setResultAndStopExecution }) {
    const store = cacheStore(args.contextValue.env, GLOBAL_CACHE_TTL_SECONDS);
    const request = args.contextValue.request as CfRequest;
    const result = urlPattern.exec(request.url);
    const logger = args.contextValue.logger;
    const { type, identifier, name } = result?.pathname.groups ?? {};
    logger.mdcSet("type", type);
    logger.mdcSet("identifier", identifier);
    logger.mdcSet("name", name);

    if (!type || !identifier || !name) {
      logger.error("Invalid subgraph URL");
      throw new Error("Invalid subgraph URL");
    }

    const parsedType = subgraphServiceType.safeParse(type);

    if (!parsedType.success) {
      logger.error("Unsupported subgraph service type");
      throw new Error("Unsupported subgraph service type");
    }
    const serviceType = parsedType.data;

    const endpoint = (() => {
      switch (serviceType) {
        case "gateway":
          return getGatewayUrl({
            apiKey: identifier,
            subgraphId: name,
          });
        case "gateway-arbitrum":
          return getArbitrumGatewayUrl({
            apiKey: identifier,
            subgraphId: name,
          });
        case "deployment-arbitrum":
          return getArbitrumDeploymentUrl({
            apiKey: identifier,
            deploymentId: name,
          });
        case "hosted":
          return getHostedServiceUrl({
            username: identifier,
            subgraphName: name,
          });
        case "studio":
          return getStudioUrl({
            studioUserNumber: identifier,
            subgraphName: name,
          });

        default:
          return null;
      }
    })();

    if (!endpoint) {
      logger.error("Unable to find service URL");
      throw new Error("Unable to find service URL");
    }

    /**
     * `graph-node` has an outdated version of introspection query.
     * We need to get https://github.com/graphprotocol/graph-node/pull/4676 resolved
     * But until then we can hijack the introspection query and use the old version.
     */
    let normalizedOp;
    if (args.operationName === "IntrospectionQuery") {
      logger.info("Overriding introspection query");
      normalizedOp = INTROSPECTION_QUERY;
    } else {
      normalizedOp = normalizeOperation({
        document: args.document,
        operationName: args.operationName,
        removeAliases: false,
        hideLiterals: false,
      });
    }

    const variables = args.variableValues;
    const cacheKey = await createHashKey({
      normalizedOp,
      type: serviceType,
      name,
      identifier,
      variables: JSON.stringify(variables),
    });
    console.log("cacher key", cacheKey);
    logger.mdcSet("cacheKey", cacheKey);

    const cachedData = await store.get(cacheKey);

    if (cachedData) {
      logger.info("Cache hit");
      args.contextValue.analytics.track({
        type: "key-usage",
        value: {
          type: "cache-hit",
          key: cacheKey,
          operationName: args.operationName,
          service: serviceType,
          name,
          identifier,
          country: request?.cf?.country || null,
          city: request?.cf?.city || null,
          latitude: request?.cf?.latitude || null,
          longitude: request?.cf?.longitude || null,
          version: "v1",
        },
      });
      return setResultAndStopExecution(
        cachedData.data as any // I trust me.
      );
    }

    const payload = JSON.stringify({
      query: normalizedOp,
      variables,
    });
    logger.info(`Cache miss - ${payload}`);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    });
    const data = await res.json();

    await store.set(cacheKey, {
      endpoint,
      operation: normalizedOp,
      data,
      variables,
    });

    args.contextValue.analytics.track({
      type: "key-usage",
      value: {
        type: "cache-write",
        key: cacheKey,
        operationName: args.operationName,
        service: serviceType,
        name,
        identifier,
        country: request?.cf?.country || null,
        city: request?.cf?.city || null,
        latitude: request?.cf?.latitude || null,
        longitude: request?.cf?.longitude || null,
        version: "v1",
      },
    });

    return setResultAndStopExecution(data);
  },
};
