import rateLimit from 'express-rate-limit';

// Generous -- Meta's real traffic can burst when several customers message
// at once. Signature verification (webhook.ts) already rejects unsigned
// garbage cheaply; this is defense in depth against a volumetric flood or a
// leaked WA_APP_SECRET being replayed.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Authenticated dashboard routes (staff/kb/templates/settings/system-prompt)
// -- protects against a compromised staff session token being used to
// hammer the API, not normal usage (a human clicking around won't get
// close to this).
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// staff/test-ai specifically -- each call is a real, billed LLM request, so
// this gets a tighter cap than general API abuse protection.
export const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many test requests -- wait a minute and try again.' },
});
