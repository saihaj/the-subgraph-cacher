import { createServer } from "node:http";
import { Plugin, createYoga } from "graphql-yoga";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { useExecutor } from "@graphql-tools/executor-yoga";
import { createRouter } from "fets";

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

const yoga = ({ endpoint }: { endpoint: string }) => {
  const remoteExecutor = buildHTTPExecutor({
    endpoint,
  });

  return createYoga({
    plugins: [skipValidate, useExecutor(remoteExecutor)],
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
