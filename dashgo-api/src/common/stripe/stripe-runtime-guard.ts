/**
 * FIX C6 — Stripe live key runtime guard (backend half).
 *
 * env.schema.ts (Zod) already covers production-time presence of secrets,
 * but Zod cannot distinguish between sk_test_* and sk_live_* without
 * coupling to a Stripe-specific regex inside the generic env schema. We
 * keep that domain knowledge here and CALL this guard from every Stripe
 * consumer's onModuleInit() (PaymentsService, SubscriptionService,
 * RentalsService) so the misconfiguration fails loudly at boot, not at
 * the first payment.
 *
 * Rules (production only):
 *   - STRIPE_SECRET_KEY must NOT start with 'sk_test_'.
 *   - STRIPE_WEBHOOK_SECRET must start with 'whsec_' (both live and test
 *     webhook secrets share that prefix — we reject anything else, which
 *     catches placeholder values or rotation typos).
 *   - STRIPE_SUBSCRIPTION_PRICE_ID must be present and non-empty.
 *
 * Non-production environments (development, test, anything else) are
 * no-ops: dev/CI uses sk_test_* freely.
 *
 * If STRIPE_SECRET_KEY itself is absent, payments are intentionally
 * disabled (each service warns and skips Stripe init). In that case the
 * guard is also a no-op — there's nothing to validate. env.schema.ts is
 * responsible for declaring STRIPE_SECRET_KEY required in production.
 */

export type AssertStripeProductionConfigInput = {
  nodeEnv: string;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  stripeSubscriptionPriceId: string | undefined;
};

export function assertStripeProductionConfig(
  input: AssertStripeProductionConfigInput,
): void {
  if (input.nodeEnv !== 'production') {
    return;
  }

  // FIX CRITICAL-G2 — distinguish undefined (intentional disable) from empty
  // string (misconfig). An operator who writes STRIPE_SECRET_KEY="" probably
  // intended to disable payments, but env.schema.ts now rejects empty
  // strings at boot. If somehow an empty string still reaches here (e.g.
  // future env loader change), fail loudly instead of silently disabling
  // every Stripe production guard.
  if (input.stripeSecretKey === undefined) {
    // Intentional payments-disabled path — env.schema.ts has already
    // accepted that the deploy lacks Stripe credentials.
    return;
  }

  const errors: string[] = [];

  if (input.stripeSecretKey === '') {
    errors.push(
      'STRIPE_SECRET_KEY is set to empty string — this is likely a ' +
        'misconfiguration. Unset the env var to intentionally disable payments.',
    );
  } else if (input.stripeSecretKey.startsWith('sk_test_')) {
    errors.push(
      'STRIPE_SECRET_KEY: production deploy is using a Stripe TEST key (sk_test_*). ' +
        'Rotate to a sk_live_* key or unset to disable payments.',
    );
  } else if (
    // FIX HIGH-G3 — positive prefix check. Negative sk_test_ matching is
    // necessary but insufficient: garbage like 'REPLACE_ME' or
    // 'sk_random_garbage' would also pass and only fail at first payment.
    // Stripe issues two real live-mode secret key shapes:
    //   sk_live_*  — full live API key
    //   rk_live_*  — restricted live key (scoped permissions)
    // Anything else in production is a deployment bug.
    !input.stripeSecretKey.startsWith('sk_live_') &&
    !input.stripeSecretKey.startsWith('rk_live_')
  ) {
    errors.push(
      'STRIPE_SECRET_KEY: must start with "sk_live_" or "rk_live_" in production. ' +
        'Got prefix: "' +
        input.stripeSecretKey.slice(0, 8) +
        '…". This catches placeholder values ' +
        '(REPLACE_ME) and Stripe rotation typos.',
    );
  }

  if (
    !input.stripeWebhookSecret ||
    !input.stripeWebhookSecret.startsWith('whsec_')
  ) {
    errors.push(
      'STRIPE_WEBHOOK_SECRET: must start with "whsec_". ' +
        'Got: ' +
        (input.stripeWebhookSecret
          ? '"' + input.stripeWebhookSecret.slice(0, 8) + '…"'
          : '(empty)'),
    );
  }

  if (!input.stripeSubscriptionPriceId) {
    errors.push(
      'STRIPE_SUBSCRIPTION_PRICE_ID: required in production when STRIPE_SECRET_KEY is set. ' +
        'Either configure it or seed subscription_plan manually.',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      'Stripe production configuration is invalid:\n  - ' +
        errors.join('\n  - '),
    );
  }
}
