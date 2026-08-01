import * as z from "zod/v4";

import { readPirschConfig } from "./config.ts";
import type { PirschConfig } from "./config.ts";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.string().min(1),
});

const domainsSchema = z.array(
  z.object({
    id: z.string().min(1),
    hostname: z.string(),
    display_name: z.string().nullish(),
    timezone: z.string().nullish(),
  }),
);

export interface PirschDomainSummary {
  id: string;
  hostname: string;
  displayName?: string;
  timezone?: string;
}

export interface PirschDomainReader {
  listDomains(): Promise<PirschDomainSummary[]>;
}

interface CachedToken {
  expiresAt: number;
  value: string;
}

export class PirschDomainLister implements PirschDomainReader {
  private token?: CachedToken;
  private tokenRequest?: Promise<CachedToken>;

  constructor(
    private readonly config: PirschConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async listDomains(): Promise<PirschDomainSummary[]> {
    let accessToken = await this.getAccessToken();
    let response = await this.requestDomains(accessToken);

    if (response.status === 401) {
      accessToken = await this.getAccessToken(true);
      response = await this.requestDomains(accessToken);
    }

    const domains = domainsSchema.parse(await this.readResponse(response, "domain listing"));

    return domains.map(({ id, hostname, display_name, timezone }) => ({
      id,
      hostname,
      ...(display_name ? { displayName: display_name } : {}),
      ...(timezone ? { timezone } : {}),
    }));
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt - 30_000 > this.now()) {
      return this.token.value;
    }

    if (!this.tokenRequest) {
      this.tokenRequest = this.requestAccessToken();
    }

    try {
      this.token = await this.tokenRequest;
      return this.token.value;
    } finally {
      this.tokenRequest = undefined;
    }
  }

  private async requestAccessToken(): Promise<CachedToken> {
    const response = await this.fetchApi("/api/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    const token = tokenSchema.parse(await this.readResponse(response, "authentication"));
    const expiresAt = Date.parse(token.expires_at);

    if (Number.isNaN(expiresAt)) {
      throw new Error("Pirsch authentication returned an invalid token expiry.");
    }

    return { value: token.access_token, expiresAt };
  }

  private requestDomains(accessToken: string): Promise<Response> {
    return this.fetchApi("/api/v1/domain", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private fetchApi(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(new URL(path, this.config.baseUrl), {
      ...init,
      signal: AbortSignal.timeout(this.config.timeout),
    });
  }

  private async readResponse(response: Response, operation: string): Promise<unknown> {
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new Error(`Pirsch ${operation} returned an invalid JSON response.`);
    }

    if (!response.ok) {
      throw new Error(
        `Pirsch ${operation} failed with status ${response.status}: ${readApiError(body)}`,
      );
    }

    return body;
  }
}

export function createPirschDomainLister(env: NodeJS.ProcessEnv = process.env): PirschDomainLister {
  return new PirschDomainLister(readPirschConfig(env));
}

function readApiError(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;

    if (Array.isArray(error) && error.every((item) => typeof item === "string")) {
      return error.join(", ");
    }
  }

  return "unknown Pirsch API error";
}
