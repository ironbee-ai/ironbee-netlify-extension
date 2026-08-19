import * as z from "zod";

// Same as the team config: IronBee is the source of truth for whether a site
// is enabled; nothing is mirrored into Netlify's site configuration store.
export const SiteConfigSchema = z.object({});

export type SiteConfig = z.output<typeof SiteConfigSchema>;
