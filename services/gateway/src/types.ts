import { AnalyticsEngine } from "./analytics";

export interface Env {
  v1_cache_the_graph: KVNamespace;
  v1_key_usage: AnalyticsEngine;
}

export type CfRequest = Request & { cf?: IncomingRequestCfProperties };
