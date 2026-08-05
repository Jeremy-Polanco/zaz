import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

function makeGuard(isPublic: boolean) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

const USER = { id: 'u-1', role: 'client' };

describe('JwtAuthGuard.handleRequest', () => {
  describe('rutas públicas', () => {
    it('resolves the user when a valid token is present', () => {
      // Esto es lo que habilita el catálogo por vendedor: una ruta @Public que
      // igual sabe quién está mirando.
      const guard = makeGuard(true);
      expect(guard.handleRequest(null, USER, null, makeContext())).toBe(USER);
    });

    it('returns null for a guest instead of throwing', () => {
      const guard = makeGuard(true);
      expect(guard.handleRequest(null, false, null, makeContext())).toBeNull();
    });

    it('returns null for an EXPIRED token instead of 401', () => {
      // Una ruta pública no puede volverse inaccesible por mandar un token
      // viejo — el invitado tiene que poder ver el catálogo igual.
      const guard = makeGuard(true);
      expect(
        guard.handleRequest(null, false, { name: 'TokenExpiredError' }, makeContext()),
      ).toBeNull();
    });

    it('returns null even when passport reports an error', () => {
      const guard = makeGuard(true);
      expect(
        guard.handleRequest(new Error('boom'), false, null, makeContext()),
      ).toBeNull();
    });
  });

  describe('rutas protegidas', () => {
    it('still returns the user when authenticated', () => {
      const guard = makeGuard(false);
      expect(guard.handleRequest(null, USER, null, makeContext())).toBe(USER);
    });

    it('STILL throws 401 without a user — abrir lo público no puede abrir lo privado', () => {
      const guard = makeGuard(false);
      expect(() =>
        guard.handleRequest(null, false, null, makeContext()),
      ).toThrow(UnauthorizedException);
    });

    it('STILL throws when passport reports an error', () => {
      const guard = makeGuard(false);
      expect(() =>
        guard.handleRequest(new Error('boom'), false, null, makeContext()),
      ).toThrow();
    });
  });
});
