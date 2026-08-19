import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { procedure, router } from "./trpc.js";
import { proveSite, proveTeam, requireSiteId, requireTeamId, visibilityOf } from "./netlify-proof.js";
import type { NetlifySiteRecord, SiteVisibility } from "./netlify-proof.js";
import { callIronbee, IronbeeApiError, IronbeeApiRoutes } from "../lib/ironbee-api.js";

// ─── The extension's API ─────────────────────────────────────────────────────
// Thin: prove the caller to Netlify, then relay to IronBee's signed API. The
// one thing that happens on Netlify's side is the deploy notification hook a
// site enable creates (and a disable deletes), on the user's own token, while
// they are in the UI — IronBee never holds a Netlify credential.

/** The Netlify hooks API event behind the "Deploy succeeded" notification (state: ready). */
const DEPLOY_SUCCEEDED_EVENT = "deploy_created";
const HOOK_TYPE_URL = "url";

const RETURN_URL_MAX = 2048;

interface ConnectionResponse {
  connected: boolean;
  status: string | null;
  accountName?: string | null;
  connectedAt?: string;
  settingsUrl?: string;
}

interface InstallResponse {
  installId: string;
  connectUrl: string;
  expiresInSeconds: number;
}

export interface SiteView {
  id: string;
  teamId: string;
  siteName: string | null;
  siteUrl: string | null;
  repoProvider: string | null;
  repoPath: string | null;
  hookId: string | null;
  contexts: string[] | null;
  protection: { kind: string; preview: string | null } | null;
  status: "active" | "disabled";
  lastEventAt: string | null;
  webhookUrl: string;
}

interface SitesListResponse {
  sites: SiteView[];
}

interface EnableResponse {
  site: SiteView;
  signatureSecret: string | null;
  alreadyEnabled: boolean;
}

interface DeployStatusResponse {
  enabled: boolean;
  site: { status: string; protection: { kind: string; preview: string | null } | null; lastEventAt: string | null } | null;
  job: {
    jobId: string;
    status: string;
    result: { status?: string; summary?: string; issues?: string[] } | null;
    createdAt: string;
    sessionUrl: string | null;
  } | null;
}

function siteInfoFor(site: NetlifySiteRecord): Record<string, string> {
  return {
    ...(site.name !== undefined ? { siteName: site.name } : {}),
    ...(site.ssl_url !== undefined ? { siteUrl: site.ssl_url } : site.url !== undefined ? { siteUrl: site.url } : {}),
    ...(site.build_settings?.provider !== undefined ? { repoProvider: site.build_settings.provider } : {}),
    ...(site.build_settings?.repo_path !== undefined ? { repoPath: site.build_settings.repo_path } : {}),
    ...(site.build_settings?.repo_url !== undefined ? { repoUrl: site.build_settings.repo_url } : {}),
  };
}

/**
 * Makes the project public on Netlify's side (`sso_login: false`), on the
 * user's own token (needs the `site:write` scope). Used automatically when only
 * the previews are private, and explicitly (a button) when production is
 * private too. Returns the visibility after the change.
 */
async function publishSite(ctx: Parameters<typeof proveSite>[0], siteId: string): Promise<SiteVisibility> {
  const changes = { sso_login: false, sso_login_context: "all" } as unknown as Partial<Awaited<ReturnType<typeof ctx.client.getSite>>>;
  const updated = (await ctx.client.updateSite(siteId, changes)) as unknown as NetlifySiteRecord;
  return visibilityOf(updated);
}

function relayError(err: unknown): never {
  if (err instanceof IronbeeApiError) {
    if (err.code === "TEAM_NOT_CONNECTED") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message, cause: err });
    }
    if (err.code === "SITE_NOT_ENABLED") {
      throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
    }
    throw new TRPCError({ code: "BAD_GATEWAY", message: "IronBee could not complete the request", cause: err });
  }
  throw err;
}

export const appRouter = router({
  connection: {
    /** Is this team bound to an IronBee account? */
    status: procedure.query(async ({ ctx }) => {
      const team = await proveTeam(ctx);
      try {
        return await callIronbee<ConnectionResponse>(IronbeeApiRoutes.CONNECTION, { teamId: team.id });
      } catch (err) {
        return relayError(err);
      }
    }),

    /** Opens the connect holding row on IronBee's side and returns the link the user follows. */
    start: procedure
      .input(z.object({ returnUrl: z.string().max(RETURN_URL_MAX).optional() }))
      .mutation(async ({ ctx, input }) => {
        const team = await proveTeam(ctx);
        try {
          return await callIronbee<InstallResponse>(IronbeeApiRoutes.INSTALL, {
            teamId: team.id,
            ...(team.slug !== undefined ? { teamSlug: team.slug } : {}),
            ...(team.name !== undefined ? { teamName: team.name } : {}),
            ...(ctx.user.id !== null ? { installerId: ctx.user.id } : {}),
            ...(input.returnUrl !== undefined ? { returnUrl: input.returnUrl } : {}),
          });
        } catch (err) {
          return relayError(err);
        }
      }),

    /** Disconnects the team on IronBee's side. Hooks IronBee no longer knows answer 410 and Netlify deletes them. */
    disconnect: procedure.mutation(async ({ ctx }) => {
      const team = await proveTeam(ctx);
      try {
        await callIronbee<Record<string, never>>(IronbeeApiRoutes.UNINSTALL, { teamId: team.id });
      } catch (err) {
        return relayError(err);
      }
      return { ok: true };
    }),
  },

  site: {
    /** This project's verification state, or null when it was never enabled. */
    status: procedure.query(async ({ ctx }) => {
      const teamId = requireTeamId(ctx);
      const siteId = requireSiteId(ctx);
      await proveSite(ctx);
      try {
        const list = await callIronbee<SitesListResponse>(IronbeeApiRoutes.SITES_LIST, { teamId });
        return list.sites.find((site) => site.id === siteId) ?? null;
      } catch (err) {
        return relayError(err);
      }
    }),

    /**
     * Enable verification: IronBee mints the webhook key + JWS secret and hands
     * both back once; the hook is created here on the user's token; IronBee is
     * told the hook id. Idempotent for an already-live site (no rotation).
     */
    enable: procedure
      .input(z.object({ contexts: z.array(z.enum(["production", "deploy-preview", "branch-deploy"])).nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const teamId = requireTeamId(ctx);
        const site = await proveSite(ctx);

        // Least work for the user: a project whose previews are private (the
        // default on new Netlify teams) cannot be verified, so when production
        // is already public the previews are made public right here, on the
        // user's token. When production is private too, this is NOT done
        // silently — making previews public would expose production — and the
        // panel offers the explicit button instead (site.makePublic).
        let visibility: SiteVisibility = visibilityOf(site);
        let previewsMadePublic = false;
        if (visibility.canAutoPublishPreviews) {
          visibility = await publishSite(ctx, site.id);
          previewsMadePublic = !visibility.previewsPrivate;
        }

        let enabled: EnableResponse;
        try {
          enabled = await callIronbee<EnableResponse>(IronbeeApiRoutes.SITES_ENABLE, {
            teamId,
            siteId: site.id,
            ...siteInfoFor(site),
            ...(input.contexts !== undefined ? { contexts: input.contexts } : {}),
          });
        } catch (err) {
          return relayError(err);
        }
        if (enabled.alreadyEnabled || enabled.signatureSecret === null) {
          return { ...enabled.site, visibility, previewsMadePublic };
        }
        // The hook: Netlify signs every delivery with signature_secret; the
        // secret is forgotten here the moment the hook exists.
        const hook = await ctx.client.createHookBySiteId(site.id, {
          type: HOOK_TYPE_URL,
          event: DEPLOY_SUCCEEDED_EVENT,
          data: { url: enabled.site.webhookUrl, signature_secret: enabled.signatureSecret },
        });
        try {
          await callIronbee<Record<string, never>>(IronbeeApiRoutes.SITES_HOOK, { teamId, siteId: site.id, hookId: hook.id });
        } catch (err) {
          return relayError(err);
        }
        return { ...enabled.site, hookId: hook.id, visibility, previewsMadePublic };
      }),

    /** The project's visibility as the agent will meet it; the panel decides what to say from it. */
    visibility: procedure.query(async ({ ctx }) => {
      const site = await proveSite(ctx);
      return visibilityOf(site);
    }),

    /**
     * Explicit consent path: the whole project goes public. Only offered when
     * production is private as well (the auto path never touches production).
     */
    makePublic: procedure.mutation(async ({ ctx }) => {
      const site = await proveSite(ctx);
      return publishSite(ctx, site.id);
    }),

    /** Disable: delete the hook while the token is at hand, then tell IronBee. */
    disable: procedure.mutation(async ({ ctx }) => {
      const teamId = requireTeamId(ctx);
      const site = await proveSite(ctx);
      let current: SiteView | null = null;
      try {
        const list = await callIronbee<SitesListResponse>(IronbeeApiRoutes.SITES_LIST, { teamId });
        current = list.sites.find((candidate) => candidate.id === site.id) ?? null;
      } catch (err) {
        return relayError(err);
      }
      if (current?.hookId) {
        try {
          await ctx.client.deleteHook(current.hookId);
        } catch (err) {
          // Best-effort: a hook that survives finds its site disabled on
          // IronBee's side, gets a 410, and Netlify deletes it.
          console.warn(`ironbee: could not delete hook ${current.hookId}: ${String(err)}`);
        }
      }
      try {
        await callIronbee<Record<string, never>>(IronbeeApiRoutes.SITES_DISABLE, { teamId, siteId: site.id });
      } catch (err) {
        return relayError(err);
      }
      return { ok: true };
    }),

    /** Which deploy contexts to verify; null restores the default (previews + branch deploys). */
    setContexts: procedure
      .input(z.object({ contexts: z.array(z.enum(["production", "deploy-preview", "branch-deploy"])).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const teamId = requireTeamId(ctx);
        const site = await proveSite(ctx);
        try {
          await callIronbee<Record<string, never>>(IronbeeApiRoutes.SITES_CONTEXTS, { teamId, siteId: site.id, contexts: input.contexts });
        } catch (err) {
          return relayError(err);
        }
        return { ok: true };
      }),

    /** Re-checks the hook Netlify holds for this site: present, paused, or gone. */
    hookHealth: procedure.query(async ({ ctx }) => {
      const teamId = requireTeamId(ctx);
      const site = await proveSite(ctx);
      let hookId: string | null = null;
      try {
        const list = await callIronbee<SitesListResponse>(IronbeeApiRoutes.SITES_LIST, { teamId });
        hookId = list.sites.find((candidate) => candidate.id === site.id)?.hookId ?? null;
      } catch (err) {
        return relayError(err);
      }
      if (hookId === null) {
        return { state: "missing" as const };
      }
      const hook = await ctx.client.getHook(hookId);
      if (hook === null) {
        return { state: "missing" as const };
      }
      return { state: hook.disabled === true ? ("paused" as const) : ("ok" as const), hookId };
    }),

    /** A paused hook (Netlify pauses after repeated failures) is re-enabled on the user's token. */
    resumeHook: procedure.mutation(async ({ ctx }) => {
      const teamId = requireTeamId(ctx);
      const site = await proveSite(ctx);
      let hookId: string | null = null;
      try {
        const list = await callIronbee<SitesListResponse>(IronbeeApiRoutes.SITES_LIST, { teamId });
        hookId = list.sites.find((candidate) => candidate.id === site.id)?.hookId ?? null;
      } catch (err) {
        return relayError(err);
      }
      if (hookId === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No hook to resume; enable verification again" });
      }
      const hook = await ctx.client.getHook(hookId);
      if (hook === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The hook no longer exists on Netlify; disable and enable verification to recreate it" });
      }
      await ctx.client.updateHook(hookId, { data: { ...(hook.data as Record<string, unknown>), url: String((hook.data as Record<string, unknown>)["url"] ?? "") } });
      return { ok: true };
    }),
  },

  deploy: {
    /** The deploy page's panel: what IronBee found for this deploy. */
    status: procedure
      .input(z.object({ deployId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const teamId = requireTeamId(ctx);
        const site = await proveSite(ctx);
        // The deploy must be this site's: a token that can read the site can
        // read its deploys, and a foreign deploy id answers with another site.
        const deploy = (await ctx.client.getDeploy(input.deployId)) as unknown as { siteId?: string; site_id?: string } | null;
        const deploySiteId = deploy?.siteId ?? deploy?.site_id;
        if (deploy === null || (deploySiteId !== undefined && deploySiteId !== site.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This deploy does not belong to the site" });
        }
        try {
          return await callIronbee<DeployStatusResponse>(IronbeeApiRoutes.DEPLOY_STATUS, {
            teamId, siteId: site.id, deployId: input.deployId,
          });
        } catch (err) {
          return relayError(err);
        }
      }),
  },
});

export type AppRouter = typeof appRouter;
