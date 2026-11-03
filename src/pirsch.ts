import { Pirsch, PirschNodeApiClient } from "pirsch-sdk";
import type { PirschFilter, Scalar } from "pirsch-sdk";

import { readPirschConfig } from "./config.ts";

export const metricNames = [
  "total",
  "visitors",
  "pages",
  "entry_pages",
  "exit_pages",
  "session_duration",
  "time_on_page",
  "conversion_goals",
  "events",
  "event_metadata",
  "event_list",
  "event_pages",
  "growth",
  "active_visitors",
  "time_of_day",
  "languages",
  "referrers",
  "operating_systems",
  "operating_system_versions",
  "browsers",
  "browser_versions",
  "countries",
  "regions",
  "cities",
  "platforms",
  "screen_classes",
  "utm_sources",
  "utm_mediums",
  "utm_campaigns",
  "utm_contents",
  "utm_terms",
  "tag_keys",
  "tags",
  "keywords",
  "funnels",
] as const;

export type Metric = (typeof metricNames)[number];

type PirschReaderMethod =
  | "domain"
  | "totalVisitors"
  | "visitors"
  | "pages"
  | "entryPages"
  | "exitPages"
  | "sessionDuration"
  | "timeOnPage"
  | "conversionGoals"
  | "events"
  | "eventMetadata"
  | "listEvents"
  | "eventPages"
  | "growth"
  | "activeVisitors"
  | "timeOfDay"
  | "languages"
  | "referrer"
  | "os"
  | "osVersions"
  | "browser"
  | "browserVersions"
  | "country"
  | "region"
  | "city"
  | "platform"
  | "screen"
  | "utmSource"
  | "utmMedium"
  | "utmCampaign"
  | "utmContent"
  | "utmTerm"
  | "tagKeys"
  | "tags"
  | "keywords"
  | "listFunnel";

export type PirschReader = Pick<PirschNodeApiClient, PirschReaderMethod>;

export interface StatisticsQuery {
  metric: Metric;
  domainId?: string;
  from: string;
  to: string;
  start?: number;
  scale?: "day" | "week" | "month" | "year";
  timezone?: string;
  path?: string;
  pattern?: string;
  entryPath?: string;
  exitPath?: string;
  event?: string;
  eventMetaKey?: string;
  eventMeta?: Record<string, Scalar>;
  language?: string;
  country?: string;
  region?: string;
  city?: string;
  referrer?: string;
  referrerName?: string;
  operatingSystem?: string;
  browser?: string;
  platform?: string;
  screenClass?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  tag?: string;
  tags?: Record<string, Scalar>;
  customMetricKey?: string;
  customMetricType?: "integer" | "float";
  search?: string;
  offset?: number;
  limit?: number;
  sort?: string;
  direction?: "asc" | "desc";
  includeAverageTimeOnPage?: boolean;
}

type MetricHandler = (client: PirschReader, filter: PirschFilter) => Promise<unknown>;

const metricHandlers: Record<Metric, MetricHandler> = {
  total: (client, filter) => client.totalVisitors(filter),
  visitors: (client, filter) => client.visitors(filter),
  pages: (client, filter) => client.pages(filter),
  entry_pages: (client, filter) => client.entryPages(filter),
  exit_pages: (client, filter) => client.exitPages(filter),
  session_duration: (client, filter) => client.sessionDuration(filter),
  time_on_page: (client, filter) => client.timeOnPage(filter),
  conversion_goals: (client, filter) => client.conversionGoals(filter),
  events: (client, filter) => client.events(filter),
  event_metadata: (client, filter) => client.eventMetadata(filter),
  event_list: (client, filter) => client.listEvents(filter),
  event_pages: (client, filter) => client.eventPages(filter),
  growth: (client, filter) => client.growth(filter),
  active_visitors: (client, filter) => client.activeVisitors(filter),
  time_of_day: (client, filter) => client.timeOfDay(filter),
  languages: (client, filter) => client.languages(filter),
  referrers: (client, filter) => client.referrer(filter),
  operating_systems: (client, filter) => client.os(filter),
  operating_system_versions: (client, filter) => client.osVersions(filter),
  browsers: (client, filter) => client.browser(filter),
  browser_versions: (client, filter) => client.browserVersions(filter),
  countries: (client, filter) => client.country(filter),
  regions: (client, filter) => client.region(filter),
  cities: (client, filter) => client.city(filter),
  platforms: (client, filter) => client.platform(filter),
  screen_classes: (client, filter) => client.screen(filter),
  utm_sources: (client, filter) => client.utmSource(filter),
  utm_mediums: (client, filter) => client.utmMedium(filter),
  utm_campaigns: (client, filter) => client.utmCampaign(filter),
  utm_contents: (client, filter) => client.utmContent(filter),
  utm_terms: (client, filter) => client.utmTerm(filter),
  tag_keys: (client, filter) => client.tagKeys(filter),
  tags: (client, filter) => client.tags(filter),
  keywords: (client, filter) => client.keywords(filter),
  funnels: (client, filter) => client.listFunnel(filter),
};

export function createPirschClient(env: NodeJS.ProcessEnv = process.env): PirschReader {
  const config = readPirschConfig(env);

  return new Pirsch({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    hostname: config.hostname,
    baseUrl: config.baseUrl,
    timeout: config.timeout,
  });
}

export async function getDomain(client: PirschReader): Promise<unknown> {
  const domain = await client.domain();

  if (!isDomain(domain)) {
    throw new Error("Pirsch did not return an accessible domain.");
  }

  return domain;
}

export async function queryStatistics(
  client: PirschReader,
  query: StatisticsQuery,
  defaultDomainId?: string,
): Promise<unknown> {
  const domainId = query.domainId ?? defaultDomainId;

  if (!domainId) {
    throw new Error("Set PIRSCH_DOMAIN_ID or pass domainId to select a Pirsch domain.");
  }

  const filter = buildPirschFilter(domainId, query);

  // pirsch-sdk forwards the filter to axios as query parameters, so date strings reach the API unchanged.
  return metricHandlers[query.metric](client, filter as unknown as PirschFilter);
}

/**
 * A Pirsch filter whose dates stay `YYYY-MM-DD` strings. pirsch-sdk types `from` and `to` as `Date`,
 * but axios serializes a `Date` as an ISO timestamp, which the Pirsch API ignores, falling back to its
 * default range of about the last week.
 */
export type StatisticsFilter = Omit<PirschFilter, "from" | "to"> & { from: string; to: string };

export function buildPirschFilter(domainId: string, query: StatisticsQuery): StatisticsFilter {
  return {
    id: domainId,
    from: query.from,
    to: query.to,
    start: query.start,
    scale: query.scale,
    tz: query.timezone,
    path: query.path,
    pattern: query.pattern,
    entry_path: query.entryPath,
    exit_path: query.exitPath,
    event: query.event,
    event_meta_key: query.eventMetaKey,
    event_meta: query.eventMeta,
    language: query.language,
    country: query.country,
    region: query.region,
    city: query.city,
    referrer: query.referrer,
    referrer_name: query.referrerName,
    os: query.operatingSystem,
    browser: query.browser,
    platform: query.platform,
    screen_class: query.screenClass,
    utm_source: query.utmSource,
    utm_medium: query.utmMedium,
    utm_campaign: query.utmCampaign,
    utm_content: query.utmContent,
    utm_term: query.utmTerm,
    tag: query.tag,
    tags: query.tags,
    custom_metric_key: query.customMetricKey,
    custom_metric_type: query.customMetricType,
    search: query.search,
    offset: query.offset,
    limit: query.limit,
    sort: query.sort,
    direction: query.direction,
    include_avg_time_on_page: query.includeAverageTimeOnPage,
  };
}

function isDomain(value: unknown): value is { id: string } {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  );
}
