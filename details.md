# IronBee for Netlify

IronBee opens every deploy preview and branch deploy of your project in a real browser and tests it the way a user would: it reads the pull request's changes, clicks through the affected flows, and reports what it found.

## What you get

- A check on the pull request (GitHub) with the verdict and the issues found, linking to the full session in IronBee.
- An IronBee panel on each deploy's page in Netlify with the same result.
- Nothing runs inside your build: verification starts when Netlify reports the deploy as live.

## Setup

1. Install the extension on your team, then open its configuration and select **Connect to IronBee**. Sign in to IronBee (or create an account) and choose the account this team belongs to.
2. Open a project, find **IronBee** in its menu and turn verification on. The extension creates a deploy notification for that project. If the project's previews are private (Netlify's default on new teams) and production is public, the previews are made public in the same step so IronBee can open them; if production is private too, the panel asks before making the project public.
3. If your previews are password protected, add the credentials in IronBee under **Settings**, then **Integrations** (Basic authentication or a visitor cookie). Public previews need nothing.

## Permissions

The extension asks for `site:read` and `site:write` (to read the project and, with your consent, make its previews public), `deploy:read` (to know which deploy it is looking at) and `hook:read`, `hook:write`, `hook:delete` (to create and remove the deploy notification). IronBee never stores a Netlify token.

## Limits

- Team login (SSO) protection cannot be bypassed; use Basic authentication, a password, or public previews.
- Production deploys are skipped unless you opt in per project.

## Support

support@ironbee.ai · https://ironbee.ai
