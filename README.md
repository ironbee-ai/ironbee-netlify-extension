# ironbee-netlify-extension

The IronBee extension for Netlify (Netlify SDK 5.x). It is the Netlify-side half of the
IronBee verification pipeline: UI surfaces in Netlify's dashboard + Netlify Functions
endpoints that talk to IronBee's integrations gateway over a signed API. See `AGENTS.md`.

```bash
npm ci
cp .env.example .env          # fill IRONBEE_EXTENSION_SECRET (dev value from IronBee SSM)
npm run dev                   # local UI + endpoints against the deployed extension's config
npm run typecheck
npm run build                 # what Netlify runs (netlify-extension build)
```

Two Netlify projects host this repo: the dev extension (`ironbee-dev`, talks to
`integrations.ironbee.dev`) and the prod extension (`ironbee`, talks to `integrations.ironbee.ai`).
Every production deploy of the hosting project updates every team that installed the
extension immediately (Netlify has no extension versioning), so prod deploys are a manual,
deliberate promotion.
