import { envSchema, Env } from './env.schema';

const validEnv = () => ({
  NODE_ENV: 'test',
  DB_USER: 'zaz_test',
  DB_PASSWORD: 'zaz_test',
  DB_NAME: 'zaz_test',
  JWT_SECRET: 'a'.repeat(32),
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  TWILIO_ACCOUNT_SID: 'AC_dummy',
  TWILIO_API_KEY_SID: 'SK_dummy',
  TWILIO_API_KEY_SECRET: 'secret',
  TWILIO_FROM_NUMBER: '+15555550100',
});

describe('envSchema', () => {
  describe('parse success cases', () => {
    it('parses a valid env successfully', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
    });
  });

  describe('defaults', () => {
    it("defaults NODE_ENV to 'development' when absent", () => {
      const env = validEnv() as Record<string, unknown>;
      delete env['NODE_ENV'];
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('development');
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
        expect(env.DB_USER).toBe('zaz_test');
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
});
