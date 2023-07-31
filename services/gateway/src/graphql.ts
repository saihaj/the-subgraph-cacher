import { Plugin } from "graphql-yoga";
import { normalizeOperation } from "@graphql-hive/core";
import { Env } from "./types";
import z from "zod";
import { INTROSPECTION_QUERY } from "./introspection-query";

export const GRAPHQL_ENDPOINT = "/:type/:identifier/:name";

const subgraphServiceType = z.enum(["hosted", "gateway", "studio"]);

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

const GLOBAL_CACHE_TTL_SECONDS = 300;

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
  type: string;
  name: string;
  identifier: string;
}) {
  const serviceKeyPrefix = `${type}:${identifier}:${name}`;
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

export const remoteExecutor: Plugin<{ env: Env }> = {
  async onExecute({ args, setResultAndStopExecution }) {
    const store = cacheStore(args.contextValue.env, GLOBAL_CACHE_TTL_SECONDS);
    const result = urlPattern.exec(args.contextValue.request.url);
    const { type, identifier, name } = result?.pathname.groups ?? {};

    if (!type || !identifier || !name) {
      console.error({ type, identifier, name }, "Invalid subgraph URL");
      throw new Error("Invalid subgraph URL");
    }

    const parsedType = subgraphServiceType.safeParse(type);

    if (!parsedType.success) {
      console.error(
        { type, identifier, name },
        "Unsupported subgraph service type"
      );
      throw new Error("Unsupported subgraph service type");
    }
    const serviceType = parsedType.data;

    console.debug({ type: serviceType, identifier, name });

    const endpoint = (() => {
      switch (serviceType) {
        case "gateway":
          return getGatewayUrl({
            apiKey: identifier,
            subgraphId: name,
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
      console.error({ type, identifier, name }, "Unable to find service URL");
      throw new Error("Unable to find service URL");
    }

    /**
     * `graph-node` has an outdated version of introspection query.
     * We need to get https://github.com/graphprotocol/graph-node/pull/4676 resolved
     * But until then we can hijack the introspection query and use the old version.
     */
    let normalizedOp;
    if (args.operationName === "IntrospectionQuery") {
      normalizedOp = INTROSPECTION_QUERY;
    } else {
      normalizedOp = normalizeOperation({
        document: args.document,
        operationName: args.operationName,
        removeAliases: false,
        hideLiterals: true,
      });
    }

    const variables = args.variableValues;
    const cacheKey = await createHashKey({
      normalizedOp,
      type,
      name,
      identifier,
      variables: JSON.stringify(variables),
    });

    console.log({
      cacheKey,
    });

    const cachedData = await store.get(cacheKey);

    if (cachedData) {
      return setResultAndStopExecution(
        cachedData.data as any // I trust me.
      );
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: normalizedOp,
        variables,
      }),
    });
    const data = await res.json();

    await store.set(cacheKey, {
      endpoint,
      operation: normalizedOp,
      data,
      variables,
    });

    console.log({
      cacheKey,
      query: normalizedOp,
      endpoint,
    });

    return setResultAndStopExecution(data);
  },
};
