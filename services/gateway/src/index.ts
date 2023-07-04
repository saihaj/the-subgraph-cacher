import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { schemaFromExecutor } from "@graphql-tools/wrap";

const endpoint = "https://api.thegraph.com/subgraphs/name/ensdomains/ens";

const remoteExecutor = buildHTTPExecutor({
  endpoint,
});

const yoga = createYoga({
  schema: schemaFromExecutor(remoteExecutor),
});

const server = createServer(yoga);

server.listen(4000, () => {
  console.log("Server is listening on port 4000");
});
