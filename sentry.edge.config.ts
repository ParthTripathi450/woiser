// Sentry is opt-in: with no SENTRY_DSN set, nothing is initialised and no data
// leaves this process.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1,
    enableLogs: true,
    sendDefaultPii: false,
  });
}
