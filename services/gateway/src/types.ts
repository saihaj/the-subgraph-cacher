import { AnalyticsEngine } from "./analytics";

export interface Env {
  v1_cache_the_graph: KVNamespace;
  v1_key_usage: AnalyticsEngine;
  loki_secret: string;
  loki_username: string;
  environment: "development" | "production";
  graph_api_key?: string;
}

export type CfRequest = Request & { cf?: IncomingRequestCfProperties };
