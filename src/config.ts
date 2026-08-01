export interface PirschConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  hostname: string;
  timeout: number;
}

export function readPirschConfig(env: NodeJS.ProcessEnv = process.env): PirschConfig {
  const clientId = env.PIRSCH_CLIENT_ID;
  const clientSecret = env.PIRSCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Pirsch credentials are missing. Set PIRSCH_CLIENT_ID and PIRSCH_CLIENT_SECRET.",
    );
  }

  const timeout = env.PIRSCH_TIMEOUT_MS ? Number(env.PIRSCH_TIMEOUT_MS) : 5000;

  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error("PIRSCH_TIMEOUT_MS must be a positive integer.");
  }

  return {
    baseUrl: env.PIRSCH_BASE_URL ?? "https://api.pirsch.io",
    clientId,
    clientSecret,
    hostname: env.PIRSCH_HOSTNAME ?? "localhost",
    timeout,
  };
}
