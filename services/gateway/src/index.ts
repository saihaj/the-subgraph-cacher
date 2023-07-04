import { createServer } from "node:http";
import { Plugin, createYoga } from "graphql-yoga";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { useExecutor } from "@graphql-tools/executor-yoga";

const endpoint = "https://api.thegraph.com/subgraphs/name/ensdomains/ens";

const remoteExecutor = buildHTTPExecutor({
  endpoint,
});

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

const yoga = createYoga({
  plugins: [skipValidate, useExecutor(remoteExecutor)],
  parserAndValidationCache: true,
  maskedErrors: false,
});

const server = createServer(yoga);

server.listen(4000, () => {
  console.log("Server is listening on port 4000");
});
