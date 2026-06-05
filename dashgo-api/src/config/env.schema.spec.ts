import { envSchema, Env } from './env.schema';

const validEnv = () => ({
  NODE_ENV: 'test',
  DB_USER: 'dashgo_test',
  DB_PASSWORD: 'dashgo_test',
  DB_NAME: 'dashgo_test',
  JWT_SECRET: 'a'.repeat(32),
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  TWILIO_ACCOUNT_SID: 'AC_dummy',
  TWILIO_API_KEY_SID: 'SK_dummy',
  TWILIO_API_KEY_SECRET: 'secret',
  TWILIO_FROM_NUMBER: '+15555550100',
  // Production requires SENTRY_DSN; including it here so production-cohort
  // tests pass without each one having to set it explicitly.
  SENTRY_DSN: 'https://abc@o0.ingest.sentry.io/1',
});

describe('envSchema', () => {
  describe('parse success cases', () => {
    it('parses a valid env successfully', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
    });
  });

  describe('defaults', () => {
    // FIX HIGH-G4 — NODE_ENV no longer has a silent 'development' default.
    // A missing NODE_ENV was silently treated as 'development', which
    // disables every production-only guard (Sentry DSN, sk_live_* check,
    // AUTH_BYPASS guard, DB_SYNCHRONIZE rejection). Now it MUST be set
    // explicitly to one of development | test | production.
    it("rejects when NODE_ENV is absent (no default — must be set explicitly)", () => {
      const env = validEnv() as Record<string, unknown>;
      delete env['NODE_ENV'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => Array.isArray(i.path) && i.path[0] === 'NODE_ENV',
        );
        expect(issue).toBeDefined();
      }
    });

    it("defaults DB_HOST to 'localhost' when absent", () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_HOST).toBe('localhost');
      }
    });

    it('defaults DB_PORT to 5432 when absent', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_PORT).toBe(5432);
      }
    });

    it("defaults DB_SYNCHRONIZE to 'false' when absent", () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_SYNCHRONIZE).toBe('false');
      }
    });

    it('defaults DB_POOL_MAX to 20 when absent', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_POOL_MAX).toBe(20);
      }
    });

    it('defaults API_PORT to 3001 when absent', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.API_PORT).toBe(3001);
      }
    });

    it("defaults JWT_ACCESS_TTL to '1h' when absent", () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.JWT_ACCESS_TTL).toBe('1h');
      }
    });

    it("defaults AUTH_BYPASS_OTP_CODE to '000000' when absent", () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.AUTH_BYPASS_OTP_CODE).toBe('000000');
      }
    });
  });

  describe('numeric coercion', () => {
    it("coerces DB_PORT '5432' to number 5432", () => {
      const result = envSchema.safeParse({ ...validEnv(), DB_PORT: '5432' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_PORT).toBe(5432);
        expect(typeof result.data.DB_PORT).toBe('number');
      }
    });

    it("fails when DB_PORT is 'abc' (non-numeric)", () => {
      const result = envSchema.safeParse({ ...validEnv(), DB_PORT: 'abc' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('DB_PORT');
      }
    });

    it("coerces DB_POOL_MAX '20' to number 20", () => {
      const result = envSchema.safeParse({ ...validEnv(), DB_POOL_MAX: '20' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DB_POOL_MAX).toBe(20);
        expect(typeof result.data.DB_POOL_MAX).toBe('number');
      }
    });

    it("coerces API_PORT '3001' to number 3001", () => {
      const result = envSchema.safeParse({ ...validEnv(), API_PORT: '3001' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.API_PORT).toBe(3001);
        expect(typeof result.data.API_PORT).toBe('number');
      }
    });

    it("coerces SENTRY_TRACES_SAMPLE_RATE '0.5' to number 0.5", () => {
      const result = envSchema.safeParse({ ...validEnv(), SENTRY_TRACES_SAMPLE_RATE: '0.5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
      }
    });
  });

  describe('enum constraints', () => {
    it("fails when NODE_ENV is 'staging' (invalid enum value)", () => {
      const result = envSchema.safeParse({ ...validEnv(), NODE_ENV: 'staging' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('NODE_ENV');
      }
    });

    it("fails when DB_SYNCHRONIZE is 'yes' (invalid enum value)", () => {
      const result = envSchema.safeParse({ ...validEnv(), DB_SYNCHRONIZE: 'yes' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('DB_SYNCHRONIZE');
      }
    });

    it("fails when DB_SSL is 'maybe' (invalid enum value)", () => {
      const result = envSchema.safeParse({ ...validEnv(), DB_SSL: 'maybe' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('DB_SSL');
      }
    });
  });

  describe('length and range constraints', () => {
    it('fails when JWT_SECRET is 31 characters (min 32)', () => {
      const result = envSchema.safeParse({ ...validEnv(), JWT_SECRET: 'a'.repeat(31) });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('JWT_SECRET');
      }
    });

    it('fails when AUTH_BYPASS_OTP_CODE is 5 characters (must be exactly 6)', () => {
      const result = envSchema.safeParse({ ...validEnv(), AUTH_BYPASS_OTP_CODE: '12345' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('AUTH_BYPASS_OTP_CODE');
      }
    });

    it('fails when AUTH_BYPASS_OTP_CODE is 7 characters (must be exactly 6)', () => {
      const result = envSchema.safeParse({ ...validEnv(), AUTH_BYPASS_OTP_CODE: '1234567' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('AUTH_BYPASS_OTP_CODE');
      }
    });

    it("fails when SENTRY_TRACES_SAMPLE_RATE is '1.5' (max 1)", () => {
      const result = envSchema.safeParse({ ...validEnv(), SENTRY_TRACES_SAMPLE_RATE: '1.5' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('SENTRY_TRACES_SAMPLE_RATE');
      }
    });

    it("fails when SENTRY_TRACES_SAMPLE_RATE is '-0.1' (min 0)", () => {
      const result = envSchema.safeParse({ ...validEnv(), SENTRY_TRACES_SAMPLE_RATE: '-0.1' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('SENTRY_TRACES_SAMPLE_RATE');
      }
    });
  });

  describe('SENTRY_DSN validation', () => {
    it('succeeds when SENTRY_DSN is a valid URL', () => {
      const result = envSchema.safeParse({ ...validEnv(), SENTRY_DSN: 'https://example.sentry.io/123' });
      expect(result.success).toBe(true);
    });

    it('succeeds when SENTRY_DSN is an empty string', () => {
      const result = envSchema.safeParse({ ...validEnv(), SENTRY_DSN: '' });
      expect(result.success).toBe(true);
    });

    it('succeeds when SENTRY_DSN is absent (undefined)', () => {
      const env = validEnv() as Record<string, unknown>;
      delete env['SENTRY_DSN'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it("fails when SENTRY_DSN is 'not-a-url' (non-empty, non-URL)", () => {
      const result = envSchema.safeParse({ ...validEnv(), SENTRY_DSN: 'not-a-url' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('SENTRY_DSN');
      }
    });
  });

  describe('cross-field conditionals', () => {
    it("fails when DB_SSL='ca' and DB_SSL_CA is absent, with issue path ['DB_SSL_CA']", () => {
      const env = { ...validEnv(), DB_SSL: 'ca' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => Array.isArray(i.path) && i.path[0] === 'DB_SSL_CA',
        );
        expect(issue).toBeDefined();
        expect(issue?.path).toEqual(['DB_SSL_CA']);
      }
    });

    it("succeeds when DB_SSL='ca' and DB_SSL_CA is provided", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        DB_SSL: 'ca',
        DB_SSL_CA: '---BEGIN CERT---',
      });
      expect(result.success).toBe(true);
    });

    it("fails when NODE_ENV='production' and DB_SYNCHRONIZE='true', with issue path ['DB_SYNCHRONIZE']", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'true',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => Array.isArray(i.path) && i.path[0] === 'DB_SYNCHRONIZE',
        );
        expect(issue).toBeDefined();
        expect(issue?.path).toEqual(['DB_SYNCHRONIZE']);
      }
    });

    it("succeeds when NODE_ENV='production' and DB_SYNCHRONIZE='false'", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production: SENTRY_DSN required', () => {
    it("fails when NODE_ENV='production' and SENTRY_DSN is absent, with issue path ['SENTRY_DSN']", () => {
      const env = {
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
      } as Record<string, unknown>;
      delete env['SENTRY_DSN'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => Array.isArray(i.path) && i.path[0] === 'SENTRY_DSN',
        );
        expect(issue).toBeDefined();
        expect(issue?.path).toEqual(['SENTRY_DSN']);
      }
    });

    it("fails when NODE_ENV='production' and SENTRY_DSN is empty string", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
        SENTRY_DSN: '',
      });
      expect(result.success).toBe(false);
    });

    it("succeeds when NODE_ENV='production' and SENTRY_DSN is set", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
        SENTRY_DSN: 'https://abc@o0.ingest.sentry.io/1',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production: TWILIO_WHATSAPP_FROM + TWILIO_WHATSAPP_OTP_TEMPLATE_SID must be set together', () => {
    it('succeeds in production when both WhatsApp vars are absent (OTP fails loudly at send-time instead of blocking boot)', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
      });
      expect(result.success).toBe(true);
    });

    it('succeeds in production when both WhatsApp vars are set', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
        TWILIO_WHATSAPP_FROM: 'whatsapp:+18001234567',
        TWILIO_WHATSAPP_OTP_TEMPLATE_SID: 'HXabc123',
      });
      expect(result.success).toBe(true);
    });

    it('fails in production when TWILIO_WHATSAPP_FROM is set without TEMPLATE_SID', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
        TWILIO_WHATSAPP_FROM: 'whatsapp:+18001234567',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) =>
            Array.isArray(i.path) && i.path[0] === 'TWILIO_WHATSAPP_OTP_TEMPLATE_SID',
        );
        expect(issue).toBeDefined();
      }
    });

    it('fails in production when TEMPLATE_SID is set without TWILIO_WHATSAPP_FROM', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
        TWILIO_WHATSAPP_OTP_TEMPLATE_SID: 'HXabc123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => Array.isArray(i.path) && i.path[0] === 'TWILIO_WHATSAPP_FROM',
        );
        expect(issue).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // FIX C1 — AUTH_BYPASS production guard
  //
  // In production, if AUTH_BYPASS_PHONES is non-empty, the OTP code and phones
  // must be safe:
  //   - AUTH_BYPASS_OTP_CODE must NOT be '000000', must be 6+ digits, all digits
  //   - every entry in AUTH_BYPASS_PHONES must be in the NANP test range
  //     (+1555555XXXX). Any other phone is rejected.
  //
  // In non-production (development/test) the guard is off — no restriction.
  // ---------------------------------------------------------------------------
  describe('production: AUTH_BYPASS guard', () => {
    const prod = () => ({
      ...validEnv(),
      NODE_ENV: 'production',
      DB_SYNCHRONIZE: 'false',
    });

    it('fails when prod + AUTH_BYPASS_PHONES set + AUTH_BYPASS_OTP_CODE is the default 000000', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '+15555550100',
        AUTH_BYPASS_OTP_CODE: '000000',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('AUTH_BYPASS_OTP_CODE');
      }
    });

    it('fails when prod + AUTH_BYPASS_PHONES set + AUTH_BYPASS_OTP_CODE is not all digits', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '+15555550100',
        AUTH_BYPASS_OTP_CODE: 'abc123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('AUTH_BYPASS_OTP_CODE');
      }
    });

    it('fails when prod + AUTH_BYPASS_PHONES contains a non-NANP-test phone like +18095551234', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '+18095551234',
        AUTH_BYPASS_OTP_CODE: '482917',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('AUTH_BYPASS_PHONES');
      }
    });

    it('succeeds when prod + AUTH_BYPASS_PHONES has a NANP test phone + a non-default 6-digit code', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '+15555550100',
        AUTH_BYPASS_OTP_CODE: '482917',
      });
      expect(result.success).toBe(true);
    });

    it('succeeds when prod + AUTH_BYPASS_PHONES is empty (no bypass in prod is fine)', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '',
        AUTH_BYPASS_OTP_CODE: '000000',
      });
      expect(result.success).toBe(true);
    });

    it('succeeds when prod + AUTH_BYPASS_PHONES has multiple NANP test phones', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '+15555550100,+15555550199',
        AUTH_BYPASS_OTP_CODE: '482917',
      });
      expect(result.success).toBe(true);
    });

    it('fails when prod + AUTH_BYPASS_PHONES mixes a NANP test phone with a real phone', () => {
      const result = envSchema.safeParse({
        ...prod(),
        AUTH_BYPASS_PHONES: '+15555550100,+18095551234',
        AUTH_BYPASS_OTP_CODE: '482917',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('AUTH_BYPASS_PHONES');
      }
    });

    it("does NOT enforce the guard in development", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'development',
        AUTH_BYPASS_PHONES: '+18095551234',
        AUTH_BYPASS_OTP_CODE: '000000',
      });
      expect(result.success).toBe(true);
    });

    it("does NOT enforce the guard in test", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'test',
        AUTH_BYPASS_PHONES: '+18095551234',
        AUTH_BYPASS_OTP_CODE: '000000',
      });
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX CRITICAL-G2 — STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET empty-string
  // bypass. An empty string was silently accepted as "set", which the runtime
  // guard then treated as "payments disabled". An operator who wrote
  // STRIPE_SECRET_KEY="" expecting to "turn it off" actually punched a hole
  // in the Stripe production-key guard. Now: unset (undefined) is allowed
  // and means "payments disabled"; "" is rejected at schema time.
  // ---------------------------------------------------------------------------
  describe('STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET non-empty when set', () => {
    it('rejects STRIPE_SECRET_KEY when set to empty string', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        STRIPE_SECRET_KEY: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('STRIPE_SECRET_KEY');
      }
    });

    it('rejects STRIPE_WEBHOOK_SECRET when set to empty string', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        STRIPE_WEBHOOK_SECRET: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('STRIPE_WEBHOOK_SECRET');
      }
    });

    it('accepts a non-empty STRIPE_SECRET_KEY', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        STRIPE_SECRET_KEY: 'sk_test_abc123',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('relaxation: STRIPE_SUBSCRIPTION_PRICE_ID', () => {
    it("succeeds when NODE_ENV='production' and STRIPE_SUBSCRIPTION_PRICE_ID is absent", () => {
      const env = {
        ...validEnv(),
        NODE_ENV: 'production',
        DB_SYNCHRONIZE: 'false',
      } as Record<string, unknown>;
      delete env['STRIPE_SUBSCRIPTION_PRICE_ID'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('succeeds when STRIPE_SUBSCRIPTION_PRICE_ID is present with a value', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        STRIPE_SUBSCRIPTION_PRICE_ID: 'price_test_monthly',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.STRIPE_SUBSCRIPTION_PRICE_ID).toBe('price_test_monthly');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // ORDER_SMS_NOTIFY_NUMBERS
  // ---------------------------------------------------------------------------

  describe('ORDER_SMS_NOTIFY_NUMBERS', () => {
    it('parses a valid two-number CSV into an array', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+19172541473,+12019081426',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual([
          '+19172541473',
          '+12019081426',
        ]);
      }
    });

    it('defaults to empty array when ORDER_SMS_NOTIFY_NUMBERS is absent', () => {
      const env = validEnv() as Record<string, unknown>;
      delete env['ORDER_SMS_NOTIFY_NUMBERS'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual([]);
      }
    });

    it('defaults to empty array when ORDER_SMS_NOTIFY_NUMBERS is empty string', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual([]);
      }
    });

    it('trims whitespace around commas', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: ' +19172541473 , +12019081426 ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual([
          '+19172541473',
          '+12019081426',
        ]);
      }
    });

    it('filters out empty entries produced by adjacent commas', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+19172541473,,+12019081426',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual([
          '+19172541473',
          '+12019081426',
        ]);
      }
    });

    it('parses a single E.164 number into a one-element array', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+19172541473',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual(['+19172541473']);
      }
    });

    it('fails when ORDER_SMS_NOTIFY_NUMBERS contains a malformed entry', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+1abc,+12019081426',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('ORDER_SMS_NOTIFY_NUMBERS');
      }
    });

    it('fails when ORDER_SMS_NOTIFY_NUMBERS contains a mixed valid+invalid entry', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+19172541473,bad',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('ORDER_SMS_NOTIFY_NUMBERS');
      }
    });

    it('fails when ORDER_SMS_NOTIFY_NUMBERS entry starts with +0 (violates E.164)', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+0123456789',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('ORDER_SMS_NOTIFY_NUMBERS');
      }
    });

    it('filters trailing commas (trailing comma → one-element array)', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ORDER_SMS_NOTIFY_NUMBERS: '+19172541473,',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ORDER_SMS_NOTIFY_NUMBERS).toEqual(['+19172541473']);
      }
    });
  });

  describe('multiple errors reported simultaneously', () => {
    it('reports issues for both JWT_SECRET and DB_USER when both are absent', () => {
      const env = validEnv() as Record<string, unknown>;
      delete env['JWT_SECRET'];
      delete env['DB_USER'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('JWT_SECRET');
        expect(paths).toContain('DB_USER');
      }
    });
  });

  describe('Env type export', () => {
    it('Env type is exported and z.infer works correctly', () => {
      // Structural type assertion: assign a parsed result to an Env-typed variable.
      // If Env type is wrong or missing, TypeScript compilation fails.
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
      if (result.success) {
        const env: Env = result.data;
        expect(env.DB_USER).toBe('dashgo_test');
        expect(env.JWT_SECRET).toBe('a'.repeat(32));
        expect(typeof env.DB_PORT).toBe('number');
      }
    });
  });

  describe('required fields', () => {
    const requiredKeys = [
      'DB_USER',
      'DB_PASSWORD',
      'DB_NAME',
      'JWT_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_API_KEY_SID',
      'TWILIO_API_KEY_SECRET',
      'TWILIO_FROM_NUMBER',
    ] as const;

    requiredKeys.forEach((key) => {
      it(`fails when ${key} is missing`, () => {
        const env = validEnv() as Record<string, unknown>;
        delete env[key];
        const result = envSchema.safeParse(env);
        expect(result.success).toBe(false);
        if (!result.success) {
          const paths = result.error.issues.map((i) => i.path[0]);
          expect(paths).toContain(key);
        }
      });
    });
  });

  // Rule 6 — AUTH_OTP_MODE='disabled' requires explicit production
  // acknowledgement. Boot must fail loudly if disabled mode reaches
  // production without AUTH_OTP_DISABLED_ACK=yes.
  describe('production: AUTH_OTP_MODE=disabled guard', () => {
    it('fails when prod + AUTH_OTP_MODE=disabled and AUTH_OTP_DISABLED_ACK absent', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        AUTH_OTP_MODE: 'disabled',
        // AUTH_OTP_DISABLED_ACK omitted — defaults to 'no'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('AUTH_OTP_DISABLED_ACK');
      }
    });

    it("fails when prod + AUTH_OTP_MODE=disabled and AUTH_OTP_DISABLED_ACK='no'", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        AUTH_OTP_MODE: 'disabled',
        AUTH_OTP_DISABLED_ACK: 'no',
      });
      expect(result.success).toBe(false);
    });

    it("succeeds when prod + AUTH_OTP_MODE=disabled and AUTH_OTP_DISABLED_ACK='yes'", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        AUTH_OTP_MODE: 'disabled',
        AUTH_OTP_DISABLED_ACK: 'yes',
      });
      expect(result.success).toBe(true);
    });

    it("succeeds when prod + AUTH_OTP_MODE='whatsapp' (default) and AUTH_OTP_DISABLED_ACK absent", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'production',
        // AUTH_OTP_MODE omitted — defaults to 'whatsapp'
      });
      expect(result.success).toBe(true);
    });

    it("does not enforce the guard in non-production environments", () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        NODE_ENV: 'development',
        AUTH_OTP_MODE: 'disabled',
        // AUTH_OTP_DISABLED_ACK omitted — defaults to 'no' — allowed in dev
      });
      expect(result.success).toBe(true);
    });
  });
});
