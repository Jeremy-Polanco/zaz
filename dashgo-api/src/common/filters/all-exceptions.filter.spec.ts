import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let statusSpy: jest.Mock;
  let jsonSpy: jest.Mock;
  let host: ArgumentsHost;
  let lastJsonPayload: Record<string, unknown> | null;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    lastJsonPayload = null;
    jsonSpy = jest.fn((payload: Record<string, unknown>) => {
      lastJsonPayload = payload;
    });
    statusSpy = jest.fn(() => ({ json: jsonSpy }));
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusSpy }),
        getRequest: () => ({ method: 'POST', url: '/api/orders' }),
      }),
    } as unknown as ArgumentsHost;
  });

  describe('BUG-3 fix: preserve structured error code', () => {
    it('passes through `code` when the exception payload is { code, message }', () => {
      const exc = new BadRequestException({
        code: 'MIXED_CART_NOT_ALLOWED',
        message: 'No podés combinar productos de alquiler con productos de compra única.',
      });

      filter.catch(exc, host);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(lastJsonPayload).toMatchObject({
        statusCode: 400,
        code: 'MIXED_CART_NOT_ALLOWED',
        message: 'No podés combinar productos de alquiler con productos de compra única.',
        path: '/api/orders',
      });
    });

    it('omits `code` when the exception payload has only `message`', () => {
      const exc = new BadRequestException('plain message');

      filter.catch(exc, host);

      expect(lastJsonPayload).toMatchObject({
        statusCode: 400,
        message: 'plain message',
      });
      expect(lastJsonPayload).not.toHaveProperty('code');
    });

    it('still includes statusCode/timestamp/path on a generic Error (5xx)', () => {
      const exc = new Error('boom');

      filter.catch(exc, host);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(lastJsonPayload).toMatchObject({
        statusCode: 500,
        path: '/api/orders',
      });
      expect(lastJsonPayload).toHaveProperty('timestamp');
    });
  });

  it('handles HttpException whose response is a bare string', () => {
    class Teapot extends HttpException {
      constructor() {
        super('I am a teapot', 418);
      }
    }

    filter.catch(new Teapot(), host);

    expect(statusSpy).toHaveBeenCalledWith(418);
    expect(lastJsonPayload).toMatchObject({
      statusCode: 418,
      message: 'I am a teapot',
    });
  });

  describe('NC1 HIGH: strips query string before exposing request URL', () => {
    // The OTP verify endpoint is the canonical leak: clients hit
    // `/api/auth/verify-otp?phone=%2B...&code=123456` and we used to
    // attach `request.url` verbatim to Sentry context and the JSON
    // response body. This test pins the path-only behavior.
    function makeHostWithUrl(url: string): ArgumentsHost {
      return {
        switchToHttp: () => ({
          getResponse: () => ({ status: statusSpy }),
          getRequest: () => ({ method: 'POST', url }),
        }),
      } as unknown as ArgumentsHost;
    }

    it('strips ?phone=...&code=... from the response body path', () => {
      const exc = new BadRequestException('bad otp');
      filter.catch(
        exc,
        makeHostWithUrl('/api/auth/verify-otp?phone=%2B15145551212&code=123456'),
      );
      expect(lastJsonPayload).toMatchObject({
        path: '/api/auth/verify-otp',
      });
      // Defensive: no fragment of the query string slips through anywhere
      // serializable in the response body.
      const serialized = JSON.stringify(lastJsonPayload);
      expect(serialized).not.toContain('phone=');
      expect(serialized).not.toContain('code=123456');
    });

    it('leaves URLs without a query string unchanged', () => {
      const exc = new BadRequestException('plain');
      filter.catch(exc, makeHostWithUrl('/api/orders'));
      expect(lastJsonPayload).toMatchObject({ path: '/api/orders' });
    });
  });
});
