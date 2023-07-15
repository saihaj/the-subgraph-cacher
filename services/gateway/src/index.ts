import { createServer } from "node:http";
import { Plugin, createLRUCache, createYoga } from "graphql-yoga";
import { createRouter } from "fets";
import { hashOperation, normalizeOperation } from "@graphql-hive/core";
import { createHash } from "crypto";

const endpoint = "https://api.thegraph.com/subgraphs/name/ensdomains/ens";

const router = createRouter();

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
  hash,
  endpoint,
  variables,
}: {
  hash: string;
  endpoint: string;
  variables: string;
}) {
  return createHash("md5")
    .update(`${hash}--${endpoint}--${variables}`)
    .digest("hex");
}

const remoteExecutor = ({ endpoint }: { endpoint: string }): Plugin => {
  return {
    async onExecute({ args, setResultAndStopExecution }) {
      const normalizedOp = normalizeOperation({
        document: args.document,
        operationName: args.operationName,
        removeAliases: true,
        hideLiterals: true,
      });
      const variables = args.variableValues;
      const hash = hashOperation(normalizedOp);
      const cacheKey = createHashKey({
        hash,
        endpoint,
        variables: JSON.stringify(variables),
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
        hash,
        endpoint,
      });
      return setResultAndStopExecution(data);
    },
  };
};

const yoga = ({ endpoint }: { endpoint: string }) => {
  return createYoga({
    plugins: [skipValidate, remoteExecutor({ endpoint })],
    parserAndValidationCache: true,
    maskedErrors: false,
    landingPage: false,
    graphqlEndpoint: "/",
  });
};

router.route({
  path: "/:username/:subgraph_name/*",
  schemas: {
    request: {
      params: {
        type: "object",
        properties: {
          username: { type: "string" },
          subgraph_name: { type: "string" },
        },
        additionalProperties: false,
        required: ["username", "subgraph_name"],
      },
    },
  } as const,
  handler: async (req, res) => {
    const { username, subgraph_name } = req.params;

    const yo = yoga({
      endpoint: `https://api.thegraph.com/subgraphs/name/${username}/${subgraph_name}`,
    });

    return yo.handle(req);
  },
});

const server = createServer(router.handle);

server.listen(4000, () => {
  console.log("Server is listening on port 4000");
});
