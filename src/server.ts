import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { createPirschDomainLister } from "./domains.ts";
import type { PirschDomainReader } from "./domains.ts";
import { createPirschClient, getDomain, metricNames, queryStatistics } from "./pirsch.ts";
import type { PirschReader, StatisticsQuery } from "./pirsch.ts";

const { version: packageVersion } = createRequire(import.meta.url)(
  "@charpeni/pirsch-mcp/package.json",
) as { version: string };

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine(isCalendarDate, "Use a valid calendar date.");
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const statisticsSchema = z
  .object({
    metric: z.enum(metricNames).describe("The Pirsch statistic to return."),
    domainId: z
      .string()
      .optional()
      .describe(
        "Pirsch domain ID, typically selected with pirsch_list_domains. Falls back to PIRSCH_DOMAIN_ID.",
      ),
    from: dateSchema.describe("Inclusive start date in YYYY-MM-DD format."),
    to: dateSchema.describe("Inclusive end date in YYYY-MM-DD format."),
    start: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .describe("Query the previous N seconds. Primarily useful for active visitors."),
    scale: z.enum(["day", "week", "month", "year"]).optional(),
    timezone: z.string().optional().describe("IANA timezone, for example Europe/Berlin."),
    path: z.string().optional(),
    pattern: z.string().optional().describe("RE2-compatible page path pattern."),
    entryPath: z.string().optional(),
    exitPath: z.string().optional(),
    event: z.string().optional(),
    eventMetaKey: z.string().optional(),
    eventMeta: z.record(z.string(), scalarSchema).optional(),
    language: z.string().optional().describe("ISO-639-1 language code."),
    country: z.string().optional().describe("ISO-3166 Alpha-2 country code."),
    region: z.string().optional(),
    city: z.string().optional(),
    referrer: z.string().optional(),
    referrerName: z.string().optional(),
    operatingSystem: z.string().optional(),
    browser: z.string().optional(),
    platform: z.enum(["desktop", "mobile", "unknown"]).optional(),
    screenClass: z.enum(["XXL", "XL", "L", "M", "S"]).optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmContent: z.string().optional(),
    utmTerm: z.string().optional(),
    tag: z.string().optional(),
    tags: z.record(z.string(), scalarSchema).optional(),
    customMetricKey: z.string().optional(),
    customMetricType: z.enum(["integer", "float"]).optional(),
    search: z.string().optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sort: z.string().optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    includeAverageTimeOnPage: z.boolean().optional(),
  })
  .refine(({ from, to }) => from <= to, {
    message: "The to date must be on or after the from date.",
    path: ["to"],
  });

export interface ServerOptions {
  clientFactory?: () => PirschReader;
  defaultDomainId?: string;
  domainListerFactory?: () => PirschDomainReader;
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "pirsch", version: packageVersion });
  const clientFactory = options.clientFactory ?? createPirschClient;
  const domainListerFactory = options.domainListerFactory ?? createPirschDomainLister;
  let client: PirschReader | undefined;
  let domainLister: PirschDomainReader | undefined;
  const getClient = () => (client ??= clientFactory());
  const getDomainLister = () => (domainLister ??= domainListerFactory());

  server.registerTool(
    "pirsch_get_domain",
    {
      description:
        "Return the Pirsch SDK's default domain. Dashboard-scoped clients return their dashboard domain. Account-scoped clients may have additional domains and should select one explicitly for statistics queries.",
      inputSchema: z.object({}),
    },
    async () => runTool(async () => getDomain(getClient())),
  );

  server.registerTool(
    "pirsch_list_domains",
    {
      description:
        "List every Pirsch domain available to the configured OAuth client. Returns safe domain summaries for selecting domainId in statistics queries.",
      inputSchema: z.object({}),
    },
    async () => runTool(async () => getDomainLister().listDomains()),
  );

  server.registerTool(
    "pirsch_query_statistics",
    {
      description:
        "Read Pirsch Analytics v1 statistics for a domain and date range. Pass domainId from pirsch_list_domains to query a specific domain. Supports traffic, pages, events, acquisition, devices, geography, tags, keywords, and funnels.",
      inputSchema: statisticsSchema,
    },
    async (input) =>
      runTool(async () =>
        queryStatistics(
          getClient(),
          input as StatisticsQuery,
          options.defaultDomainId ?? process.env.PIRSCH_DOMAIN_ID,
        ),
      ),
  );

  return server;
}

async function runTool(operation: () => Promise<unknown>) {
  try {
    const result = await operation();

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    return {
      content: [{ type: "text" as const, text: formatError(error) }],
      isError: true,
    };
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown Pirsch error occurred.";
}

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
