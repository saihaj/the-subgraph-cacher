import { createYoga } from "graphql-yoga";
import { Env } from "./types";
import { remoteExecutor, skipValidate } from "./graphql";
import { GRAPHQL_ENDPOINT } from "./constant";
import { createAnalytics } from "./analytics";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const analytics = createAnalytics({ keyUsage: env.v1_key_usage });

    const yoga = createYoga({
      plugins: [skipValidate, remoteExecutor],
      parserAndValidationCache: true,
      maskedErrors: false,
      landingPage: false,
      context: {
        env,
        analytics,
      },
      graphqlEndpoint: GRAPHQL_ENDPOINT,
    });

    return yoga.fetch(request, env, ctx);
  },
};
