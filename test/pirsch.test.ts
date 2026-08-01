import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import type { PirschConfig } from "../src/config.ts";
import { PirschDomainLister } from "../src/domains.ts";
import {
  buildPirschFilter,
  createPirschClient,
  metricNames,
  queryStatistics,
} from "../src/pirsch.ts";
import type { Metric, PirschReader, StatisticsQuery } from "../src/pirsch.ts";
import { createServer } from "../src/server.ts";
import type { ServerOptions } from "../src/server.ts";

const { version: packageVersion } = createRequire(import.meta.url)(
  "@charpeni/pirsch-mcp/package.json",
) as { version: string };

const baseQuery: StatisticsQuery = {
  metric: "total",
  domainId: "domain-1",
  from: "2026-07-01",
  to: "2026-07-31",
};

const domainListerConfig: PirschConfig = {
  baseUrl: "https://api.pirsch.test",
  clientId: "client-id",
  clientSecret: "client-secret",
  hostname: "localhost",
  timeout: 5000,
};

const metricMethods: Record<Metric, string> = {
  total: "totalVisitors",
  visitors: "visitors",
  pages: "pages",
  entry_pages: "entryPages",
  exit_pages: "exitPages",
  session_duration: "sessionDuration",
  time_on_page: "timeOnPage",
  conversion_goals: "conversionGoals",
  events: "events",
  event_metadata: "eventMetadata",
  event_list: "listEvents",
  event_pages: "eventPages",
  growth: "growth",
  active_visitors: "activeVisitors",
  time_of_day: "timeOfDay",
  languages: "languages",
  referrers: "referrer",
  operating_systems: "os",
  operating_system_versions: "osVersions",
  browsers: "browser",
  browser_versions: "browserVersions",
  countries: "country",
  regions: "region",
  cities: "city",
  platforms: "platform",
  screen_classes: "screen",
  utm_sources: "utmSource",
  utm_mediums: "utmMedium",
  utm_campaigns: "utmCampaign",
  utm_contents: "utmContent",
  utm_terms: "utmTerm",
  tag_keys: "tagKeys",
  tags: "tags",
  keywords: "keywords",
  funnels: "listFunnel",
};

test("buildPirschFilter maps MCP fields to Pirsch SDK fields", () => {
  const filter = buildPirschFilter("domain-1", {
    ...baseQuery,
    timezone: "Europe/Berlin",
    eventMeta: { plan: "pro" },
    includeAverageTimeOnPage: true,
  });

  assert.equal(filter.id, "domain-1");
  assert.equal(filter.from.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(filter.to.toISOString(), "2026-07-31T00:00:00.000Z");
  assert.equal(filter.tz, "Europe/Berlin");
  assert.deepEqual(filter.event_meta, { plan: "pro" });
  assert.equal(filter.include_avg_time_on_page, true);
});

test("queryStatistics requires an explicit or configured domain ID", async () => {
  await assert.rejects(
    queryStatistics({} as PirschReader, { ...baseQuery, domainId: undefined }, undefined),
    /Set PIRSCH_DOMAIN_ID or pass domainId/,
  );
});

test("queryStatistics uses the configured default domain ID", async () => {
  const client = {
    totalVisitors: async (filter: { id: string }) => ({ id: filter.id }),
  } as unknown as PirschReader;

  const result = await queryStatistics(
    client,
    { ...baseQuery, domainId: undefined },
    "default-domain",
  );

  assert.deepEqual(result, { id: "default-domain" });
});

test("queryStatistics prefers an explicit domain ID", async () => {
  const client = {
    totalVisitors: async (filter: { id: string }) => ({ id: filter.id }),
  } as unknown as PirschReader;

  const result = await queryStatistics(client, baseQuery, "default-domain");

  assert.deepEqual(result, { id: "domain-1" });
});

test("queryStatistics dispatches every advertised metric", async () => {
  for (const metric of metricNames) {
    let calledMethod = "";
    const client = new Proxy(
      {},
      {
        get: (_target, property) => async () => {
          calledMethod = String(property);
          return null;
        },
      },
    ) as PirschReader;

    await queryStatistics(client, { ...baseQuery, metric });

    assert.equal(calledMethod, metricMethods[metric], metric);
  }
});

test("createPirschClient reports missing credentials without starting the server", () => {
  assert.throws(() => createPirschClient({}), /Set PIRSCH_CLIENT_ID and PIRSCH_CLIENT_SECRET/);
});

test("createPirschClient rejects a partial timeout value", () => {
  assert.throws(
    () =>
      createPirschClient({
        PIRSCH_CLIENT_ID: "client",
        PIRSCH_CLIENT_SECRET: "secret",
        PIRSCH_TIMEOUT_MS: "100ms",
      }),
    /PIRSCH_TIMEOUT_MS must be a positive integer/,
  );
});

test("PirschDomainLister caches its token and returns safe domain summaries", async () => {
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  let tokenRequests = 0;
  let domainRequests = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/v1/token")) {
      tokenRequests += 1;
      return Response.json({
        access_token: "token-1",
        expires_at: new Date(now + 3_600_000).toISOString(),
      });
    }

    domainRequests += 1;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token-1");

    return Response.json([
      {
        id: "domain-1",
        hostname: "example.com",
        display_name: "Example",
        timezone: "Europe/Berlin",
        identification_code: "must-not-leak",
        settings: { private: true },
      },
    ]);
  };
  const lister = new PirschDomainLister(domainListerConfig, fetchImpl, () => now);

  const [first, second] = await Promise.all([lister.listDomains(), lister.listDomains()]);

  assert.deepEqual(first, [
    {
      id: "domain-1",
      hostname: "example.com",
      displayName: "Example",
      timezone: "Europe/Berlin",
    },
  ]);
  assert.deepEqual(second, first);
  assert.equal(tokenRequests, 1);
  assert.equal(domainRequests, 2);
});

test("PirschDomainLister refreshes its token once after a 401", async () => {
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  let tokenRequests = 0;
  const authorizations: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/v1/token")) {
      tokenRequests += 1;
      return Response.json({
        access_token: `token-${tokenRequests}`,
        expires_at: new Date(now + 3_600_000).toISOString(),
      });
    }

    authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");

    if (authorizations.length === 1) {
      return Response.json({ error: ["expired token"] }, { status: 401 });
    }

    return Response.json([{ id: "domain-1", hostname: "example.com" }]);
  };
  const lister = new PirschDomainLister(domainListerConfig, fetchImpl, () => now);

  const domains = await lister.listDomains();

  assert.deepEqual(domains, [{ id: "domain-1", hostname: "example.com" }]);
  assert.deepEqual(authorizations, ["Bearer token-1", "Bearer token-2"]);
  assert.equal(tokenRequests, 2);
});

test("PirschDomainLister refreshes a token near expiry", async () => {
  let now = Date.parse("2026-08-01T00:00:00.000Z");
  let tokenRequests = 0;
  const authorizations: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/api/v1/token")) {
      tokenRequests += 1;
      return Response.json({
        access_token: `token-${tokenRequests}`,
        expires_at: new Date(now + 60_000).toISOString(),
      });
    }

    authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
    return Response.json([{ id: "domain-1", hostname: "example.com" }]);
  };
  const lister = new PirschDomainLister(domainListerConfig, fetchImpl, () => now);

  await lister.listDomains();
  now += 40_000;
  await lister.listDomains();

  assert.deepEqual(authorizations, ["Bearer token-1", "Bearer token-2"]);
  assert.equal(tokenRequests, 2);
});

test("PirschDomainLister reports invalid API responses", async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    if (String(input).endsWith("/api/v1/token")) {
      return Response.json({
        access_token: "token-1",
        expires_at: "2030-01-01T00:00:00.000Z",
      });
    }

    return new Response("not-json", { status: 200 });
  };
  const lister = new PirschDomainLister(domainListerConfig, fetchImpl);

  await assert.rejects(lister.listDomains(), /invalid JSON response/);
});

test("MCP lists the public tools, complete metric schema, and package version", async () => {
  await withMcpClient({}, async (client) => {
    const { tools } = await client.listTools();
    const statisticsTool = tools.find(({ name }) => name === "pirsch_query_statistics");
    const metricSchema = statisticsTool?.inputSchema.properties?.metric as
      | { enum?: unknown[] }
      | undefined;

    assert.deepEqual(
      tools.map(({ name }) => name),
      ["pirsch_get_domain", "pirsch_list_domains", "pirsch_query_statistics"],
    );
    assert.deepEqual(metricSchema?.enum, metricNames);
    assert.equal(client.getServerVersion()?.version, packageVersion);
  });
});

test("MCP lists every accessible domain without exposing full domain records", async () => {
  let factoryCalls = 0;

  await withMcpClient(
    {
      domainListerFactory: () => {
        factoryCalls += 1;
        return {
          listDomains: async () => [
            {
              id: "domain-1",
              hostname: "example.com",
              displayName: "Example",
              timezone: "Europe/Berlin",
            },
            { id: "domain-2", hostname: "shop.example.com" },
          ],
        };
      },
    },
    async (client) => {
      const first = await client.callTool({ name: "pirsch_list_domains", arguments: {} });
      const second = await client.callTool({ name: "pirsch_list_domains", arguments: {} });

      assert.deepEqual(JSON.parse(readTextContent(first.content)), [
        {
          id: "domain-1",
          hostname: "example.com",
          displayName: "Example",
          timezone: "Europe/Berlin",
        },
        { id: "domain-2", hostname: "shop.example.com" },
      ]);
      assert.equal(second.isError, undefined);
      assert.equal(factoryCalls, 1);
    },
  );
});

test("MCP queries the domain selected after listing domains", async () => {
  let queriedDomainId = "";
  const pirschClient = {
    pages: async (filter: { id: string }) => {
      queriedDomainId = filter.id;
      return [];
    },
  } as unknown as PirschReader;

  await withMcpClient(
    {
      clientFactory: () => pirschClient,
      defaultDomainId: "default-domain",
      domainListerFactory: () => ({
        listDomains: async () => [
          { id: "domain-1", hostname: "example.com" },
          { id: "domain-2", hostname: "shop.example.com" },
        ],
      }),
    },
    async (client) => {
      const domainsResult = await client.callTool({
        name: "pirsch_list_domains",
        arguments: {},
      });
      const domains = JSON.parse(readTextContent(domainsResult.content)) as Array<{ id: string }>;

      await client.callTool({
        name: "pirsch_query_statistics",
        arguments: {
          metric: "pages",
          domainId: domains[1]?.id,
          from: "2026-07-01",
          to: "2026-07-31",
        },
      });

      assert.equal(queriedDomainId, "domain-2");
    },
  );
});

test("MCP rejects invalid tool input at the protocol boundary", async () => {
  await withMcpClient({}, async (client) => {
    const result = await client.callTool({
      name: "pirsch_query_statistics",
      arguments: {
        metric: "pages",
        domainId: "domain-1",
        from: "2026-02-30",
        to: "2026-03-01",
      },
    });

    assert.equal(result.isError, true);
    assert.match(readTextContent(result.content), /valid calendar date/);
  });
});

test("MCP returns tool failures as error results", async () => {
  await withMcpClient(
    {
      clientFactory: () => {
        throw new Error("credentials unavailable");
      },
    },
    async (client) => {
      const result = await client.callTool({ name: "pirsch_get_domain", arguments: {} });

      assert.equal(result.isError, true);
      assert.match(readTextContent(result.content), /credentials unavailable/);
    },
  );
});

test("MCP reuses one Pirsch client across tool calls", async () => {
  let factoryCalls = 0;
  const pirschClient = {
    domain: async () => ({ id: "domain-1" }),
    totalVisitors: async () => ({ visitors: 42 }),
  } as unknown as PirschReader;

  await withMcpClient(
    {
      clientFactory: () => {
        factoryCalls += 1;
        return pirschClient;
      },
    },
    async (client) => {
      await client.callTool({ name: "pirsch_get_domain", arguments: {} });
      await client.callTool({
        name: "pirsch_query_statistics",
        arguments: { ...baseQuery },
      });

      assert.equal(factoryCalls, 1);
    },
  );
});

test("compiled executable serves MCP over stdio", async () => {
  const client = new Client({ name: "pirsch-mcp-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/index.js"],
    cwd: process.cwd(),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();

    assert.deepEqual(
      tools.map(({ name }) => name),
      ["pirsch_get_domain", "pirsch_list_domains", "pirsch_query_statistics"],
    );
  } finally {
    await client.close();
  }
});

async function withMcpClient(
  options: ServerOptions,
  operation: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createServer(options);
  const client = new Client({ name: "pirsch-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    await operation(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function readTextContent(content: unknown[]): string {
  const block = content[0];

  assert.ok(block && typeof block === "object" && "type" in block && block.type === "text");
  assert.ok("text" in block && typeof block.text === "string");

  return block.text;
}
