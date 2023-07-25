import { createYoga } from "graphql-yoga";
import { Env } from "./types";
import { GRAPHQL_ENDPOINT, remoteExecutor, skipValidate } from "./graphql";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const yoga = createYoga({
      plugins: [skipValidate, remoteExecutor],
      parserAndValidationCache: true,
      maskedErrors: false,
      landingPage: false,
      context: {
        env,
      },
      graphqlEndpoint: GRAPHQL_ENDPOINT,
    });

    return yoga.fetch(request, env, ctx);
  },
};
