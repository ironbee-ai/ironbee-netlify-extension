import { createHmac } from "node:crypto";

// ─── The signed client for IronBee's /netlify/* API ─────────────────────────
// Every call is a POST with a JSON body, signed with the shared secret:
// HMAC-SHA256 over `<unix seconds>.<raw body>` (hex), plus the timestamp
// itself, in the two x-ironbee-* headers. IronBee rejects a signature older
// than five minutes. The secret lives only in this site's environment
// (IRONBEE_EXTENSION_SECRET) and in IronBee's SSM; it never reaches the UI.

const SIGNATURE_HEADER = "x-ironbee-signature";
const TIMESTAMP_HEADER = "x-ironbee-timestamp";
const MS_PER_SECOND = 1000;

export const IronbeeApiRoutes = {
  INSTALL: "/netlify/install",
  CONNECTION: "/netlify/connection",
  SITES_LIST: "/netlify/sites/list",
  SITES_ENABLE: "/netlify/sites/enable",
  SITES_HOOK: "/netlify/sites/hook",
  SITES_DISABLE: "/netlify/sites/disable",
  SITES_CONTEXTS: "/netlify/sites/contexts",
  DEPLOY_STATUS: "/netlify/deploy-status",
  UNINSTALL: "/netlify/uninstall",
} as const;

export type IronbeeApiRoute = (typeof IronbeeApiRoutes)[keyof typeof IronbeeApiRoutes];

export class IronbeeApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "IronbeeApiError";
    this.status = status;
    this.code = code;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Exported so a test can pin the exact bytes IronBee verifies. */
export function signRequest(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export async function callIronbee<T>(route: IronbeeApiRoute, body: Record<string, unknown>): Promise<T> {
  const baseUrl = requiredEnv("IRONBEE_API_BASE_URL").replace(/\/$/, "");
  const secret = requiredEnv("IRONBEE_EXTENSION_SECRET");
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / MS_PER_SECOND));
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signRequest(secret, timestamp, rawBody),
      [TIMESTAMP_HEADER]: timestamp,
    },
    body: rawBody,
  });
  const text = await response.text();
  if (!response.ok) {
    let code: string | null = null;
    let message = `IronBee answered ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      code = parsed.code ?? null;
      message = parsed.message ?? message;
    } catch {
      // not JSON — keep the status message
    }
    throw new IronbeeApiError(response.status, code, message);
  }
  return (text.length > 0 ? JSON.parse(text) : {}) as T;
}
