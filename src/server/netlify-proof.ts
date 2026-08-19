import { TRPCError } from "@trpc/server";
import type { Context } from "@netlify/sdk/ui/functions/trpc";

// ─── Proving the caller to Netlify before trusting the request ──────────────
// The SDK builds `ctx` from the Nf-UIExt-* headers the Netlify UI sends and does
// NOT verify them server-side: anyone can POST to this function with a made-up
// teamId/siteId. What a forgery cannot fake is a token Netlify accepts. So
// before a single id is forwarded to IronBee, the endpoint spends the token on
// a read of exactly that team or site: a forged token dies here, and a real
// token for another team cannot read this one's site.

/** The fields of a Netlify site this extension reads (the SDK's Site type is narrower than the JSON). */
export interface NetlifySiteRecord {
  id: string;
  name?: string;
  url?: string;
  ssl_url?: string;
  account_id?: string;
  account_slug?: string;
  build_settings?: {
    provider?: string;
    repo_path?: string;
    repo_url?: string;
  };
  /**
   * Project visibility, measured on the live API (2026-08-19; not in the
   * public OpenAPI spec): `sso_login: false` = everything public;
   * `sso_login: true` + `sso_login_context: "non_production"` = previews
   * private, production public; `sso_login: true` + `"all"` = both private.
   * There is no "production private, previews public" state.
   */
  sso_login?: boolean;
  sso_login_context?: "all" | "non_production";
  /** Password visibility (Pro+); the API refuses it on Free with 422. */
  has_password?: boolean;
  password_context?: "all" | "non_production";
}

/** What the agent will meet on this site's previews, derived from the site record. */
export interface SiteVisibility {
  previewsPrivate: boolean;
  productionPrivate: boolean;
  passwordProtected: boolean;
  /**
   * Previews can be opened without touching production: only when production
   * is already public (context "non_production"). When both are private, making
   * previews public means making production public too — never done silently.
   */
  canAutoPublishPreviews: boolean;
}

export function visibilityOf(site: NetlifySiteRecord): SiteVisibility {
  const privateOn = site.sso_login === true;
  const previewsPrivate = privateOn;
  const productionPrivate = privateOn && site.sso_login_context === "all";
  return {
    previewsPrivate,
    productionPrivate,
    passwordProtected: site.has_password === true,
    canAutoPublishPreviews: previewsPrivate && !productionPrivate,
  };
}

export interface NetlifyTeamRecord {
  id: string;
  name?: string;
  slug?: string;
}

/** One line about a failed Netlify call: status + text when the client carries them, else the message. */
function describe(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const e = err as { status?: number; message?: string; text?: string; json?: unknown };
    const parts = [
      e.status !== undefined ? `status ${String(e.status)}` : null,
      typeof e.message === "string" ? e.message.slice(0, 160) : null,
      typeof e.text === "string" ? e.text.slice(0, 160) : null,
    ].filter((p): p is string => p !== null);
    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }
  return String(err).slice(0, 160);
}

export function requireTeamId(ctx: Context): string {
  if (!ctx.teamId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "teamId is required" });
  }
  return ctx.teamId;
}

export function requireSiteId(ctx: Context): string {
  if (!ctx.siteId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "siteId is required" });
  }
  return ctx.siteId;
}

/** The team the token can read; anything else is a forgery. */
export async function proveTeam(ctx: Context): Promise<NetlifyTeamRecord> {
  const teamId = requireTeamId(ctx);
  try {
    const account = (await ctx.client.getAccount(teamId)) as NetlifyTeamRecord;
    if (account.id !== teamId) {
      throw new Error("account id mismatch");
    }
    return account;
  } catch (err) {
    // P3 probe: the underlying Netlify/Jigsaw answer is surfaced in the message
    // (no secret can be in it) so the first live runs tell us which call the
    // extension token is allowed to make; tighten once measured.
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: `Netlify did not accept this request for the team (${describe(err)})`,
      cause: err,
    });
  }
}

/** The site the token can read, and it must belong to the team the request names. */
export async function proveSite(ctx: Context): Promise<NetlifySiteRecord> {
  const teamId = requireTeamId(ctx);
  const siteId = requireSiteId(ctx);
  let site: NetlifySiteRecord;
  try {
    site = (await ctx.client.getSite(siteId)) as unknown as NetlifySiteRecord;
  } catch (err) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: `Netlify did not accept this request for the site (${describe(err)})`,
      cause: err,
    });
  }
  if (site.id !== siteId || (site.account_id !== undefined && site.account_id !== teamId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This site does not belong to the team" });
  }
  return site;
}
