// Documentation: https://developers.netlify.com/sdk/
//
// The IronBee Netlify extension. No build event handlers, no injected
// functions: the extension is UI surfaces + endpoints that talk to IronBee's
// integrations gateway. The deploy notification hook it creates per site is
// what triggers verification; the extension itself never runs in a build.
import { NetlifyExtension } from "@netlify/sdk";
import type { TeamConfig } from "./schema/team-config.js";
import type { SiteConfig } from "./schema/site-config.js";

const extension = new NetlifyExtension<SiteConfig, TeamConfig>();

export { extension };
