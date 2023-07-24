import { Plugin, createLRUCache } from "graphql-yoga";
import { normalizeOperation } from "@graphql-hive/core";
import { Env } from "./types";

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

const GLOBAL_CACHE_TTL_SECONDS = 60;

type CacheData = {
  operation: string;
  endpoint: string;
  data: string;
  variables: Record<string, any>;
};

const cacheStore = (env: Env, ttl: number) => {
  return {
    async get(key: string) {
      const data = await env.subgraph_cacher_hosted_service.get<CacheData>(
        key,
        "json"
      );

      if (!data) {
        return null;
      }

      return data;
    },
    async set(key: string, data: CacheData) {
      await env.subgraph_cacher_hosted_service.put(key, JSON.stringify(data), {
        expirationTtl: ttl,
      });
    },
  };
};

async function createHashKey({
  endpoint,
  variables,
  normalizedOp,
}: {
  normalizedOp: string;
  endpoint: string;
  variables: string;
}) {
  const encode = new TextEncoder().encode(
    JSON.stringify({ endpoint, variables, normalizedOp })
  );
  const encrypted = await crypto.subtle.digest("md5", encode);

  return [...new Uint8Array(encrypted)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const hostedServicePattern = new URLPattern({
  pathname: "/:username/:subgraph_name/graphql",
});

export const remoteExecutor: Plugin<{ env: Env }> = {
  async onExecute({ args, setResultAndStopExecution }) {
    const store = cacheStore(args.contextValue.env, GLOBAL_CACHE_TTL_SECONDS);
    const result = hostedServicePattern.exec(args.contextValue.request.url);
    const { username, subgraph_name } = result?.pathname.groups ?? {};

    if (!username || !subgraph_name) {
      console.error({ username, subgraph_name }, "Invalid subgraph URL");
      throw new Error("Invalid subgraph URL");
    }

    console.debug({
      username,
      subgraph_name,
    });

    const endpoint = `https://api.thegraph.com/subgraphs/name/${username}/${subgraph_name}`;

    const normalizedOp = normalizeOperation({
      document: args.document,
      operationName: args.operationName,
      removeAliases: false,
      hideLiterals: true,
    });

    const variables = args.variableValues;
    const cacheKey = await createHashKey({
      normalizedOp,
      endpoint,
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
