import { createYoga } from "graphql-yoga";
import { Env } from "./types";
import { remoteExecutor, skipValidate } from "./graphql";
import { GRAPHQL_ENDPOINT } from "./constant";
import { createAnalytics } from "./analytics";
import { Logger } from "workers-loki-logger";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const analytics = createAnalytics({ keyUsage: env.v1_key_usage });
    const logger = new Logger({
      cloudflareContext: ctx,
      lokiUrl: "https://logs-prod-006.grafana.net",
      stream: {
        worker: "cache-the-graph",
        environment: "production",
      },
      lokiSecret: btoa(`${env.loki_username}:${env.loki_secret}`),
    });

    const yoga = createYoga({
      plugins: [skipValidate, remoteExecutor],
      parserAndValidationCache: true,
      maskedErrors: false,
      landingPage: false,
      context: {
        env,
        analytics,
        logger,
      },
      graphqlEndpoint: GRAPHQL_ENDPOINT,
    });

    let response;
    try {
      response = await yoga.fetch(request, env, ctx);
    } catch (e) {
      logger.error("Caught error", e);
      response = new Response("Internal Server Error", { status: 500 });
    } finally {
      await logger.flush();
    }

    return response;
  },
};
