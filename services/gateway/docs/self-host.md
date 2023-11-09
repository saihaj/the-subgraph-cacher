# Self Hosting

You can self host this proxy your own CloudFlare Workers giving you more control over the analytics data, tweaking cache keys and the ability to use your own sub-domains.

## Pre-requisites

1. Node.js 18+
2. [pnpm](https://pnpm.io/installation)

## Deploying

1. Fork this repo to your own GitHub account
2. Clone your fork to your local machine
3. Run `pnpm install` to install dependencies
4. Update the `wrangler.toml` file with your own CloudFlare account ID and zone ID
5. Run `wrangler publish` to deploy the gateway to your CloudFlare Workers

## Hiding your API key

Added benefit of self hosting is you can hide your API keys from the clients. This worker supports a special path (`thegraph`). You can [set an environment secret](https://developers.cloudflare.com/workers/configuration/secrets/) of key `graph_api_key` when deploying the worker and it will be used to make requests:

```
http://127.0.0.1:8787/[gateway|gateway-arbitrum|deployment-arbitrum]/thegraph/[subgraph-id]
```
