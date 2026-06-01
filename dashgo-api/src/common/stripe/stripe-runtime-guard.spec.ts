/**
 * Unit specs for assertStripeProductionConfig (FIX C6 — backend half).
 *
 * In production we MUST NOT boot with Stripe test mode credentials. A live
 * deploy that accidentally points at sk_test_* would silently fail every
 * real payment (Stripe rejects with "Cannot use a test key with a live …")
 * and a sk_test_ key in production logs is also a security signal.
 *
 * The guard rejects boot in production when:
 *   - STRIPE_SECRET_KEY starts with 'sk_test_'
 *   - STRIPE_WEBHOOK_SECRET does NOT start with 'whsec_'
 *   - STRIPE_SUBSCRIPTION_PRICE_ID is missing
 *
 * In non-production, the guard is a no-op so dev/CI keeps working with
 * test credentials.
 */

import { assertStripeProductionConfig } from './stripe-runtime-guard';

describe('assertStripeProductionConfig (FIX C6)', () => {
  // -------------------------------------------------------------------------
  // STRIPE_SECRET_KEY
  // -------------------------------------------------------------------------

  describe('STRIPE_SECRET_KEY', () => {
    it('throws when NODE_ENV=production and STRIPE_SECRET_KEY starts with sk_test_', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_test_abc123',
          stripeWebhookSecret: 'whsec_live123',
          stripeSubscriptionPriceId: 'price_live_xyz',
        }),
      ).toThrow(/STRIPE_SECRET_KEY/i);
    });

    it('passes when NODE_ENV=production and STRIPE_SECRET_KEY starts with sk_live_', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc123',
          stripeWebhookSecret: 'whsec_live123',
          stripeSubscriptionPriceId: 'price_live_xyz',
        }),
      ).not.toThrow();
    });

    it('does NOT throw in development even with sk_test_ key', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'development',
          stripeSecretKey: 'sk_test_abc123',
          stripeWebhookSecret: 'whsec_test123',
          stripeSubscriptionPriceId: 'price_test_xyz',
        }),
      ).not.toThrow();
    });

    it('does NOT throw in test even with sk_test_ key', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'test',
          stripeSecretKey: 'sk_test_abc123',
          stripeWebhookSecret: 'whsec_test123',
          stripeSubscriptionPriceId: 'price_test_xyz',
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // STRIPE_WEBHOOK_SECRET
  // -------------------------------------------------------------------------

  describe('STRIPE_WEBHOOK_SECRET', () => {
    it('throws in production when STRIPE_WEBHOOK_SECRET does NOT start with whsec_', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc',
          stripeWebhookSecret: 'plain_secret_no_prefix',
          stripeSubscriptionPriceId: 'price_live',
        }),
      ).toThrow(/STRIPE_WEBHOOK_SECRET/i);
    });

    it('passes in production with a whsec_ prefix (either live or test format)', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc',
          stripeWebhookSecret: 'whsec_abcd',
          stripeSubscriptionPriceId: 'price_live',
        }),
      ).not.toThrow();
    });

    it('does NOT throw in development when webhook secret lacks the prefix', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'development',
          stripeSecretKey: 'sk_test_abc',
          stripeWebhookSecret: 'dev_secret',
          stripeSubscriptionPriceId: 'price_dev',
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // STRIPE_SUBSCRIPTION_PRICE_ID
  // -------------------------------------------------------------------------

  describe('STRIPE_SUBSCRIPTION_PRICE_ID', () => {
    it('throws in production when STRIPE_SUBSCRIPTION_PRICE_ID is missing (undefined)', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc',
          stripeWebhookSecret: 'whsec_abcd',
          stripeSubscriptionPriceId: undefined,
        }),
      ).toThrow(/STRIPE_SUBSCRIPTION_PRICE_ID/i);
    });

    it('throws in production when STRIPE_SUBSCRIPTION_PRICE_ID is empty string', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc',
          stripeWebhookSecret: 'whsec_abcd',
          stripeSubscriptionPriceId: '',
        }),
      ).toThrow(/STRIPE_SUBSCRIPTION_PRICE_ID/i);
    });

    it('passes in production when STRIPE_SUBSCRIPTION_PRICE_ID is set', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc',
          stripeWebhookSecret: 'whsec_abcd',
          stripeSubscriptionPriceId: 'price_live_monthly',
        }),
      ).not.toThrow();
    });

    it('does NOT throw in development when STRIPE_SUBSCRIPTION_PRICE_ID is missing', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'development',
          stripeSecretKey: 'sk_test_abc',
          stripeWebhookSecret: 'whsec_test_abc',
          stripeSubscriptionPriceId: undefined,
        }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // No-op when STRIPE_SECRET_KEY is absent (payments disabled)
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // FIX CRITICAL-G2 — distinguish undefined (intentional disable) from
  // empty string (misconfig). An operator who writes STRIPE_SECRET_KEY=""
  // expecting to "turn it off" needs a loud failure instead of a silent
  // payments-disabled mode that quietly skips every Stripe production guard.
  // ---------------------------------------------------------------------------
  describe('payments-disabled path', () => {
    it('is a no-op when stripeSecretKey is undefined (matches "payments disabled" branch)', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: undefined,
          stripeWebhookSecret: undefined,
          stripeSubscriptionPriceId: undefined,
        }),
      ).not.toThrow();
    });

    it('THROWS when stripeSecretKey is empty string in production (misconfig, not intentional disable)', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: '',
          stripeWebhookSecret: '',
          stripeSubscriptionPriceId: '',
        }),
      ).toThrow(/STRIPE_SECRET_KEY.*empty/i);
    });

    it('is a no-op when stripeSecretKey is empty string in non-production', () => {
      // Outside production we don't try to second-guess local dev / CI
      // shapes. Empty in dev is harmless — the dev simply doesn't have
      // Stripe wired up locally.
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'development',
          stripeSecretKey: '',
          stripeWebhookSecret: '',
          stripeSubscriptionPriceId: '',
        }),
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // FIX HIGH-G3 — positive sk_live_ / rk_live_ prefix check.
  //
  // Rejecting sk_test_* is necessary but not sufficient. Garbage like
  // 'REPLACE_ME' or 'sk_random_garbage' would pass the negative check, hit
  // Stripe, and fail at first payment in production. Require a positive
  // prefix instead.
  //
  // Stripe issues two real production secret key shapes:
  //   - sk_live_*  — full live API key
  //   - rk_live_*  — restricted live key (scoped permissions)
  // Anything else in production is rejected.
  // ---------------------------------------------------------------------------
  describe('STRIPE_SECRET_KEY positive prefix (FIX HIGH-G3)', () => {
    it('passes in production with sk_live_ prefix', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_live_abc123',
          stripeWebhookSecret: 'whsec_abc',
          stripeSubscriptionPriceId: 'price_live',
        }),
      ).not.toThrow();
    });

    it('passes in production with rk_live_ prefix (restricted live key)', () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'rk_live_abc123',
          stripeWebhookSecret: 'whsec_abc',
          stripeSubscriptionPriceId: 'price_live',
        }),
      ).not.toThrow();
    });

    it("rejects production with 'REPLACE_ME' placeholder", () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'REPLACE_ME',
          stripeWebhookSecret: 'whsec_abc',
          stripeSubscriptionPriceId: 'price_live',
        }),
      ).toThrow(/STRIPE_SECRET_KEY/);
    });

    it("rejects production with 'sk_random_garbage' (looks Stripe-ish but is not a live or test key)", () => {
      expect(() =>
        assertStripeProductionConfig({
          nodeEnv: 'production',
          stripeSecretKey: 'sk_random_garbage',
          stripeWebhookSecret: 'whsec_abc',
          stripeSubscriptionPriceId: 'price_live',
        }),
      ).toThrow(/STRIPE_SECRET_KEY/);
    });
  });
});
