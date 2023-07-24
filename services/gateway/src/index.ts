import { createServer } from "node:http";
import { Plugin, createLRUCache, createYoga } from "graphql-yoga";
import { normalizeOperation } from "@graphql-hive/core";
import { createHash } from "crypto";

/**
 * It is a safe assumption that we skip validation on this gateway
 * we are just caching data here. If we don't have data
 * we will pass through to the remote executor and remote validates it.
 */
const skipValidate: Plugin = {
  onValidate({ setResult }) {
    setResult([]);
  },
};

const cache = createLRUCache<{
  operation: string;
  endpoint: string;
  data: string;
  variables: Record<string, any>;
}>();

function createHashKey({
  endpoint,
  variables,
  normalizedOp,
}: {
  normalizedOp: string;
  endpoint: string;
  variables: string;
}) {
  return createHash("md5")
    .update(endpoint, "utf8")
    .update(variables, "utf8")
    .update(normalizedOp, "utf8")
    .digest("hex");
}

const hostedServicePattern = new URLPattern({
  pathname: "/:username/:subgraph_name/graphql",
});

const remoteExecutor: Plugin = {
  async onExecute({ args, setResultAndStopExecution, setExecuteFn }) {
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
    const cacheKey = createHashKey({
      normalizedOp,
      endpoint,
      variables: JSON.stringify(variables),
    });

    console.log({
      cacheKey,
    });

    const cachedData = cache.get(cacheKey);

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

    cache.set(cacheKey, {
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

const yoga = createYoga({
  plugins: [skipValidate, remoteExecutor],
  parserAndValidationCache: true,
  maskedErrors: false,
  landingPage: false,
  graphqlEndpoint: "/:username/:subgraph_name/graphql",
});

const server = createServer(yoga);

server.listen(4000, () => {
  console.log("Server is listening on port 4000");
});
