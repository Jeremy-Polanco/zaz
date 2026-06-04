/**
 * Tests for the PII scrubber that backs the Sentry beforeSend / beforeBreadcrumb
 * hooks (NC1 fix). The contract:
 *
 *   - Any key matching SENSITIVE_KEY_REGEX is redacted, at any depth.
 *   - Non-sensitive keys are preserved (no over-redaction).
 *   - Arrays are mapped, not flattened.
 *   - Primitives pass through unchanged.
 *   - Recursion stops at SENTRY_SCRUB_DEPTH_LIMIT to defend against cycles.
 *   - stripQueryString strips everything from the first `?` onward.
 *
 * If you change these guarantees you almost certainly need to update the
 * mobile mirror at dashgo/src/lib/sentry.ts too.
 */
import {
  SENTRY_SCRUB_DEPTH_LIMIT,
  scrubObject,
  stripQueryString,
} from './scrub';

describe('scrubObject', () => {
  it('redacts sensitive top-level keys', () => {
    const input = {
      phone: '+15145551212',
      otp: '123456',
      access_token: 'eyJhbGciOi...',
      refreshToken: 'refresh-xyz',
      authorization: 'Bearer abc',
      cookie: 'sid=...',
      email: 'me@example.com',
      address: '742 Evergreen',
      lat: 45.5,
      lng: -73.5,
      cardNumber: '4242424242424242',
      cvv: '123',
      ssn: '000-00-0000',
      stripeSignature: 'whsec_...',
      webhookSecret: 's3cr3t',
      // non-sensitive keys must NOT be redacted
      name: 'Diego',
      orderId: 42,
    };

    const out = scrubObject(input) as Record<string, unknown>;

    for (const key of [
      'phone',
      'otp',
      'access_token',
      'refreshToken',
      'authorization',
      'cookie',
      'email',
      'address',
      'lat',
      'lng',
      'cardNumber',
      'cvv',
      'ssn',
      'stripeSignature',
      'webhookSecret',
    ]) {
      expect(out[key]).toBe('[redacted]');
    }
    expect(out.name).toBe('Diego');
    expect(out.orderId).toBe(42);
  });

  it('redacts sensitive keys at every depth (deep nested fixture)', () => {
    // The redactor matches by KEY NAME — `tokens` itself matches /token/i so
    // its whole subtree becomes the redaction sentinel. To prove "redacts at
    // every depth" we put the leaf sensitive key under a NON-sensitive
    // parent (`creds` rather than `tokens`).
    const input = {
      request: {
        body: {
          user: {
            profile: {
              phone: '+15145551212',
              otp_code: '999000',
              creds: {
                access_token: 'eyJ...',
                displayName: 'Diego',
              },
            },
          },
        },
      },
    };

    const out = scrubObject(input) as {
      request: {
        body: {
          user: {
            profile: {
              phone: string;
              otp_code: string;
              creds: { access_token: string; displayName: string };
            };
          };
        };
      };
    };

    expect(out.request.body.user.profile.phone).toBe('[redacted]');
    expect(out.request.body.user.profile.otp_code).toBe('[redacted]');
    expect(out.request.body.user.profile.creds.access_token).toBe('[redacted]');
    expect(out.request.body.user.profile.creds.displayName).toBe('Diego');
  });

  it('redacts the entire subtree when a parent key matches (e.g. `tokens`)', () => {
    // Sanity-check the by-key behavior: when an intermediate key matches
    // the regex (here `tokens` → /token/i), the whole subtree is replaced
    // by the redaction sentinel — children are NOT walked.
    const input = { tokens: { access_token: 'eyJ...', other: 'x' } };
    const out = scrubObject(input) as { tokens: unknown };
    expect(out.tokens).toBe('[redacted]');
  });

  it('preserves arrays (maps element-wise rather than flattening)', () => {
    const input = {
      items: [
        { phone: '+1', name: 'a' },
        { phone: '+2', name: 'b' },
      ],
    };
    const out = scrubObject(input) as {
      items: { phone: string; name: string }[];
    };
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].phone).toBe('[redacted]');
    expect(out.items[0].name).toBe('a');
    expect(out.items[1].phone).toBe('[redacted]');
    expect(out.items[1].name).toBe('b');
  });

  it('passes primitives through unchanged', () => {
    expect(scrubObject('hello')).toBe('hello');
    expect(scrubObject(42)).toBe(42);
    expect(scrubObject(true)).toBe(true);
    expect(scrubObject(null)).toBeNull();
    expect(scrubObject(undefined)).toBeUndefined();
  });

  it('kicks in the depth limit at SENTRY_SCRUB_DEPTH_LIMIT and never recurses past it', () => {
    // Build a chain MUCH deeper than the limit. The leaf must become the
    // `[depth-limit]` sentinel, proving the redactor bailed out before
    // recursing forever.
    type Chain = { next: Chain | { leaf: string } };
    let leaf: Chain | { leaf: string } = { leaf: 'leaf-value' };
    for (let i = 0; i < SENTRY_SCRUB_DEPTH_LIMIT + 5; i++) {
      leaf = { next: leaf };
    }

    const result = scrubObject(leaf) as Record<string, unknown>;

    // The depth check fires when (depth > LIMIT) → first call at depth=0
    // returns the object, recursion enters with depth=1...LIMIT, and the
    // call at depth=LIMIT+1 returns the sentinel. Walk `.next` LIMIT+1 times
    // to land exactly on the bail-out value.
    let cursor: unknown = result;
    for (let i = 0; i < SENTRY_SCRUB_DEPTH_LIMIT + 1; i++) {
      cursor = (cursor as { next: unknown }).next;
    }
    expect(cursor).toBe('[depth-limit]');
  });

  it('does not throw on cyclic objects (depth limit guards recursion)', () => {
    type Cyclic = { name: string; self?: Cyclic };
    const a: Cyclic = { name: 'a' };
    a.self = a; // cycle

    expect(() => scrubObject(a)).not.toThrow();
  });
});

describe('stripQueryString', () => {
  it('strips everything from the first ? onward', () => {
    expect(
      stripQueryString('/api/auth/verify-otp?phone=%2B&code=123456'),
    ).toBe('/api/auth/verify-otp');
  });

  it('returns the url unchanged when no query string', () => {
    expect(stripQueryString('/api/orders')).toBe('/api/orders');
  });

  it('works on absolute URLs', () => {
    expect(stripQueryString('https://api.example.com/x?k=v')).toBe(
      'https://api.example.com/x',
    );
  });

  it('returns malformed input as-is rather than throwing', () => {
    expect(stripQueryString('not-a-url')).toBe('not-a-url');
    expect(stripQueryString('')).toBe('');
  });
});
