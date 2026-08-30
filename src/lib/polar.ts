import { Polar } from "@polar-sh/sdk";
import { env } from "./env";

/**
 * Null whenever billing is switched off (or no token is configured), so the
 * whole Polar dependency stays dormant. Go through src/lib/billing.ts rather
 * than reaching for this directly.
 */
export const polar =
  env.BILLING_ENABLED && env.POLAR_ACCESS_TOKEN
    ? new Polar({
        accessToken: env.POLAR_ACCESS_TOKEN,
        server: env.POLAR_SERVER,
      })
    : null;
