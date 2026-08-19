# AGENTS.md — ironbee-netlify-extension

The Netlify extension of the IronBee verification pipeline. Netlify SDK **5.x** (`@netlify/sdk`),
React UI surfaces rendered inside Netlify's dashboard, tRPC endpoints running as Netlify Functions
on the hosting project. The IronBee side (webhook, domain, console) lives in the IronBee monorepo:
`docs/verification-job/VERIFICATION_JOB_DESIGN.md` § 10.9 is the authoritative design.

## What this extension does, and does not

- **Does:** tells IronBee a team installed (connect link), enables/disables verification per
  project by creating/deleting Netlify's **deploy notification hook** on the user's own token,
  shows the verification result on the deploy page. Every IronBee call is signed
  (`src/lib/ironbee-api.ts`: HMAC-SHA256 over `<unix seconds>.<raw body>`, headers
  `x-ironbee-signature` / `x-ironbee-timestamp`; the secret is `IRONBEE_EXTENSION_SECRET` in this
  site's environment = IronBee SSM `netlify.extension.secret`).
- **Does not:** run in the customer's build (no build event handlers), hold or forward a Netlify
  token to IronBee, write anything to Netlify's extension configuration store (both zod schemas are
  empty on purpose; IronBee is the source of truth).

## Structure

```
extension.yaml            # slug (Netlify-assigned, dev: ironbee-dev, prod: ironbee), name, three UI surfaces
netlify.toml              # netlify-extension build/dev; functions dir = src/endpoints
details.md                # the marketplace/details page text (required for publishing)
src/index.ts              # NetlifyExtension (no handlers)
src/lib/ironbee-api.ts    # callIronbee(route, body) — the signed client; IronbeeApiError carries status + code
src/server/netlify-proof.ts  # proveTeam / proveSite: spend the user's token on a read of THAT team/site
                          #   before any id is forwarded (the SDK does not verify Nf-UIExt-* headers)
src/server/router.ts      # tRPC: connection.{status,start,disconnect}, site.{status,enable,disable,
                          #   setContexts,hookHealth,resumeHook}, deploy.status
src/endpoints/trpc.ts     # the one Netlify Function: /api/trpc
src/ui/App.tsx            # SurfaceRouter → TeamConfiguration / SiteConfiguration / SiteDeploy
src/ui/surfaces/*.tsx     # the three surfaces (team: connect; project: enable + contexts + hook health;
                          #   deploy page: verdict + session link)
src/ui/copy.ts            # every user-facing string
```

## Flows

| Surface | Procedure | What happens |
|---|---|---|
| Team → Connect | `connection.start` | proveTeam → IronBee `POST /netlify/install` → connect link (`/integrations/netlify/connect?install=<nonce>`) shown as a new-tab button; the user binds the team to an account in the console; "refresh" re-reads `connection.status` |
| Project → Turn on | `site.enable` | proveSite → previews private & production public → `updateSite({sso_login:false})` (auto-public) → IronBee `POST /netlify/sites/enable` (mints webhook key + JWS secret, returns the secret ONCE) → `client.createHookBySiteId(siteId, {type:'url', event:'deploy_created', data:{url, signature_secret}})` → IronBee `POST /netlify/sites/hook`. Idempotent for a live site (no rotation). |
| Project → Turn off | `site.disable` | proveSite → `client.deleteHook` (best-effort) → IronBee `POST /netlify/sites/disable` |
| Project → hook health | `site.hookHealth` / `site.resumeHook` | `client.getHook`: missing / paused (`disabled: true`, Netlify pauses after repeated failures) / ok; resume = `updateHook` on the user's token |
| Project → visibility | `site.visibility` / `site.makePublic` | previews/production private? password? → explicit whole-project publish when production is private too |
| Deploy page | `deploy.status` | proveSite + `client.getDeploy(deployId)` belongs to the site → IronBee `POST /netlify/deploy-status` → verdict, summary, issues, console session link; polls every 15 s while running |
| Team → Disconnect | `connection.disconnect` | IronBee `POST /netlify/uninstall`; hooks IronBee no longer knows answer 410 and Netlify deletes them |

`deploy_created` is the hooks-API name of the "Deploy succeeded" notification (deploy `state: ready`);
IronBee filters on the deploy's state, so a wrong event name costs nothing but a probe. Netlify does
NOT retry deliveries and pauses a hook after six consecutive failures; the project surface shows that.

## Project visibility (measured live, 2026-08-19)

Netlify's "Project visibility" is not in the public OpenAPI spec but IS a site field:
`sso_login` (false = public; true = Netlify-login gate) + `sso_login_context` (`all` = production and
previews; `non_production` = previews only; nothing else is accepted). `PATCH /api/v1/sites/{id}`
with those two fields changes it (the UI does the same). Password visibility = `password` +
`password_context`, Pro+ only (422 on Free). New Netlify teams create projects private by default.

`site.enable` therefore makes previews public automatically when production is already public
(`non_production` → `sso_login: false`) — the least work for the user. When production is private
too, nothing is changed silently: the panel offers the explicit **Make the project public** button
(`site.makePublic`), with the Pro password alternative in the copy. Needs the `site:write` scope.

## Netlify-side facts this code assumes (probe before the first customer install)

- An extension-scoped token (`hook:write`) can create a deploy notification with `signature_secret`.
- `client.getAccount(teamId)` / `client.getSite(siteId)` refuse a forged token (the proof in
  `netlify-proof.ts` rests on it).
- Surfaces render only for teams that installed the extension; the project surface appears in the
  project's top-level navigation, the team surface on the extension's details page.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `IRONBEE_API_BASE_URL` | hosting project env | `https://integrations.ironbee.dev` (dev) / `https://integrations.ironbee.ai` (prod) |
| `IRONBEE_EXTENSION_SECRET` | hosting project env (secret) | the same value as IronBee SSM `core/integrations/netlify.extension.secret` |

## Rules

- User-facing strings live in `src/ui/copy.ts`; no em dashes in description strings.
- Never log a `signatureSecret`, a hook secret or the extension secret; the secret is used once
  and forgotten in `site.enable`.
- Braces on all `if`/`else`; explicit types; no `any`.
- Publishing: private → public unlisted → listed is one-way; the hosting project cannot be deleted;
  every production deploy updates all installed teams at once, so promote to prod deliberately.
