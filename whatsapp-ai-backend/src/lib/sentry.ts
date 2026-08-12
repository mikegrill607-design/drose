import * as Sentry from '@sentry/node';

// Safe to import even before a DSN exists -- every call becomes a no-op
// until SENTRY_DSN is set in Railway, so this can ship now and just start
// working the moment the env var is added, no code change needed then.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    // Cheap to leave on at this traffic volume -- lowers before it'd ever
    // matter for cost, since the free tier is capped by error count, not
    // trace count.
    tracesSampleRate: 0.2,
  });
  console.log('Sentry error monitoring enabled');
} else {
  console.log('SENTRY_DSN not set -- error monitoring disabled (see Settings docs to enable)');
}

export { Sentry };
