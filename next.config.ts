import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    // Voice uploads are posted as a raw binary body.
    proxyClientMaxBodySize: "20mb",
  },
};

// Only route the build through Sentry when it is actually configured, so a
// clone with no Sentry account builds cleanly.
const sentryEnabled = Boolean(
  process.env.SENTRY_DSN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
      webpack: {
        treeshake: { removeDebugLogging: true },
      },
    })
  : nextConfig;
