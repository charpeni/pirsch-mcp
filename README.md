# Pirsch MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for the [Pirsch Analytics API v1](https://docs.pirsch.io/api-sdks/api-guide-v1), written in TypeScript.

The server uses the official [`pirsch-sdk`](https://github.com/pirsch-analytics/pirsch-js-sdk) and exposes no tracking or configuration writes.

## Installation

Requirements: Node.js 22.19 or later and a Pirsch OAuth client with read scopes.

Most MCP clients can run the package on demand without a global installation. Add the following server configuration, replacing the credential placeholders:

```json
{
  "mcpServers": {
    "pirsch": {
      "command": "npx",
      "args": ["-y", "@charpeni/pirsch-mcp"],
      "env": {
        "PIRSCH_CLIENT_ID": "your-client-id",
        "PIRSCH_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Alternatively, install the executable globally:

```bash
npm install --global @charpeni/pirsch-mcp
```

Then configure your MCP client to run `pirsch-mcp`.

Create an **OAuth** client from the Pirsch dashboard's **Integration Settings** or **Account Settings**. Disable write operations to keep its scopes read-only. Pirsch access keys beginning with `pa_` are write-only and cannot read statistics.

## Tools

### `pirsch_list_domains`

Lists every domain available to the configured OAuth client. Each result contains only the fields needed to select a statistics target: `id`, `hostname`, and optional `displayName` and `timezone` values.

Account-scoped OAuth clients can use this tool to discover all accessible domains. Agents can switch domains by passing the selected `id` as `domainId` to `pirsch_query_statistics`.

### `pirsch_get_domain`

Returns the Pirsch SDK's default domain. Dashboard-scoped clients return their dashboard domain. Account-scoped clients can access multiple domains, so use the Pirsch dashboard to select the intended `PIRSCH_DOMAIN_ID`.

### `pirsch_query_statistics`

Queries traffic, pages, events, acquisition, device, geography, tag, keyword, and funnel statistics.

Available metrics:

```text
total, visitors, pages, entry_pages, exit_pages, session_duration,
time_on_page, conversion_goals, events, event_metadata, event_list,
event_pages, growth, active_visitors, time_of_day, languages, referrers,
operating_systems, operating_system_versions, browsers, browser_versions,
countries, regions, cities, platforms, screen_classes, utm_sources,
utm_mediums, utm_campaigns, utm_contents, utm_terms, tag_keys, tags,
keywords, funnels
```

Example:

```json
{
  "metric": "pages",
  "from": "2026-07-01",
  "to": "2026-07-31",
  "limit": 10,
  "sort": "visitors",
  "direction": "desc"
}
```

The `domainId` argument can be omitted when `PIRSCH_DOMAIN_ID` is configured. The server never automatically selects a domain for statistics queries because account-scoped clients can access multiple domains.

A typical multi-domain flow is:

1. Call `pirsch_list_domains`.
2. Match the requested hostname or display name.
3. Pass that domain's `id` to `pirsch_query_statistics`.

## Configuration

| Environment variable   | Required | Default                 | Description                                  |
| ---------------------- | -------- | ----------------------- | -------------------------------------------- |
| `PIRSCH_CLIENT_ID`     | Yes      |                         | Pirsch OAuth client ID                       |
| `PIRSCH_CLIENT_SECRET` | Yes      |                         | Pirsch OAuth client secret                   |
| `PIRSCH_DOMAIN_ID`     | No       |                         | Default domain ID; otherwise pass `domainId` |
| `PIRSCH_HOSTNAME`      | No       | `localhost`             | Hostname passed to the SDK; unused by reads  |
| `PIRSCH_BASE_URL`      | No       | `https://api.pirsch.io` | Pirsch API base URL                          |
| `PIRSCH_TIMEOUT_MS`    | No       | `5000`                  | Positive request timeout in milliseconds     |

Credentials are loaded lazily. MCP clients can start the server and list its tools without credentials, but tool calls require them.

## MCP Inspector

Set the required credentials in your shell:

```bash
export PIRSCH_CLIENT_ID="your-client-id"
export PIRSCH_CLIENT_SECRET="your-client-secret"
```

Inspect the published package:

```bash
npx -y @modelcontextprotocol/inspector \
  -e "PIRSCH_CLIENT_ID=$PIRSCH_CLIENT_ID" \
  -e "PIRSCH_CLIENT_SECRET=$PIRSCH_CLIENT_SECRET" \
  npx -y @charpeni/pirsch-mcp
```

Inspector does not forward arbitrary shell variables to spawned `stdio` servers, so the credentials are passed explicitly with `-e`.

## Development

Install dependencies and run the complete quality gate:

```bash
pnpm install
pnpm check
```

List the local server's tools through Inspector without Pirsch credentials:

```bash
pnpm inspect:list
```

Run the local Inspector web UI after exporting the credentials:

```bash
pnpm inspect
```

Other development commands:

```bash
pnpm dev
pnpm build
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```
