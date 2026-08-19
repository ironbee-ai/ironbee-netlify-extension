import * as z from "zod";

// Nothing IronBee needs lives in Netlify's team configuration store: the
// binding lives on IronBee's side and is asked for over the signed API. The
// schema exists for the SDK's generics and stays empty on purpose.
export const TeamConfigSchema = z.object({});

export type TeamConfig = z.output<typeof TeamConfigSchema>;
