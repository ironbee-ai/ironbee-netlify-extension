import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signRequest } from "../src/lib/ironbee-api.js";

// The exact bytes IronBee's webhook-handler verifies (src/netlify/s2s.ts:
// HMAC-SHA256 over `<timestamp>.<raw body>`, hex). Keep in sync.
describe("signRequest", () => {
  it("signs `<timestamp>.<body>` with HMAC-SHA256 hex", () => {
    const secret = "shared";
    const body = JSON.stringify({ teamId: "team_1" });
    const expected = createHmac("sha256", secret).update(`1700000000.${body}`).digest("hex");
    expect(signRequest(secret, "1700000000", body)).toBe(expected);
  });
});
