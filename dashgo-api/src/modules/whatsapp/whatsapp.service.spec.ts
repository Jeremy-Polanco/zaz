/**
 * WhatsAppService — Meta WhatsApp Cloud API OTP sender.
 *
 * Covers the send contract that auth.service depends on:
 *   1. Dev seed phones (+1555555XXXX) are logged, never hit Meta.
 *   2. Unconfigured service logs in non-prod, throws in production.
 *   3. Happy path POSTs the right template payload to graph.facebook.com.
 *   4. Non-2xx responses throw WhatsAppApiError carrying { status, code }.
 *   5. Network failures throw WhatsAppApiError (no status).
 *
 * `fetch` is mocked globally — we never make a real network call.
 */
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppApiError } from './whatsapp-api.error';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

const FULL_CONFIG: Record<string, string> = {
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token',
  WHATSAPP_OTP_TEMPLATE_NAME: 'dashgo_otp',
  WHATSAPP_OTP_TEMPLATE_LANG: 'es',
  WHATSAPP_API_VERSION: 'v22.0',
  WHATSAPP_OTP_TEMPLATE_HAS_BUTTON: 'true',
};

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: 'wamid.test' }] }),
  } as unknown as Response;
}

function errorResponse(
  status: number,
  body: { error?: { code?: number; error_subcode?: number; message?: string } },
): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('WhatsAppService', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('logs seeded dev phones and never calls Meta', async () => {
    const svc = new WhatsAppService(makeConfig(FULL_CONFIG));
    await svc.sendOtp('+15555550001', '123456');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs and returns (no throw) when unconfigured in non-production', async () => {
    process.env.NODE_ENV = 'development';
    const svc = new WhatsAppService(makeConfig({}));
    await expect(
      svc.sendOtp('+18095551234', '123456'),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws WhatsAppApiError when unconfigured in production', async () => {
    process.env.NODE_ENV = 'production';
    const svc = new WhatsAppService(makeConfig({}));
    await expect(svc.sendOtp('+18095551234', '123456')).rejects.toBeInstanceOf(
      WhatsAppApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the template payload to the Graph API on the happy path', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const svc = new WhatsAppService(makeConfig(FULL_CONFIG));

    await svc.sendOtp('+18095551234', '654321');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://graph.facebook.com/v22.0/123456789012345/messages',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer EAAG-test-token',
    );
    const payload = JSON.parse(init.body as string);
    expect(payload.messaging_product).toBe('whatsapp');
    // recipient is sent without the leading '+'
    expect(payload.to).toBe('18095551234');
    expect(payload.type).toBe('template');
    expect(payload.template.name).toBe('dashgo_otp');
    expect(payload.template.language.code).toBe('es');
    // body param carries the code
    const body = payload.template.components.find(
      (c: { type: string }) => c.type === 'body',
    );
    expect(body.parameters[0].text).toBe('654321');
    // copy-code button component carries the code too (default has-button=true)
    const button = payload.template.components.find(
      (c: { type: string }) => c.type === 'button',
    );
    expect(button).toBeDefined();
    expect(button.sub_type).toBe('url');
    expect(button.parameters[0].text).toBe('654321');
  });

  it('omits the button component when WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const svc = new WhatsAppService(
      makeConfig({ ...FULL_CONFIG, WHATSAPP_OTP_TEMPLATE_HAS_BUTTON: 'false' }),
    );

    await svc.sendOtp('+18095551234', '654321');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    const button = payload.template.components.find(
      (c: { type: string }) => c.type === 'button',
    );
    expect(button).toBeUndefined();
  });

  it('throws WhatsAppApiError with status + Meta code on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, {
        error: {
          code: 131026,
          error_subcode: 0,
          message: 'Message undeliverable',
        },
      }),
    );
    const svc = new WhatsAppService(makeConfig(FULL_CONFIG));

    let captured: unknown = null;
    try {
      await svc.sendOtp('+18095551234', '654321');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(WhatsAppApiError);
    expect((captured as WhatsAppApiError).status).toBe(400);
    expect((captured as WhatsAppApiError).code).toBe(131026);
  });

  it('throws WhatsAppApiError (no status) on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const svc = new WhatsAppService(makeConfig(FULL_CONFIG));

    let captured: unknown = null;
    try {
      await svc.sendOtp('+18095551234', '654321');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(WhatsAppApiError);
    expect((captured as WhatsAppApiError).status).toBeUndefined();
  });
});
