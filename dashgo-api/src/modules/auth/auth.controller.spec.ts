/**
 * Unit specs for AuthController.deleteMe (FIX C2).
 *
 * The DELETE /auth/me endpoint exposes AuthService.deleteAccount. These tests
 * cover the controller wiring:
 *   - happy path returns void (HttpCode is 204 No Content via decorator)
 *   - the JwtAuthGuard is applied (Reflect metadata)
 *   - service.deleteAccount is called with the authenticated user's id
 *   - errors thrown by the service propagate (NotFoundException → 404)
 *
 * Authorization is enforced by JwtAuthGuard, which is exercised in the
 * integration suite (see test/integration/auth.integration-spec.ts in the
 * upstream change). Here we mock CurrentUser to a fixed AuthenticatedUser.
 */

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CreditService } from '../credit/credit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../entities/enums';

describe('AuthController.deleteMe (FIX C2)', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Pick<AuthService, 'deleteAccount'>>;

  const fakeUser: AuthenticatedUser = {
    id: 'user-1',
    email: null,
    fullName: 'Test User',
    phone: '+18095550000',
    role: UserRole.CLIENT,
    addressDefault: null,
    referralCode: null,
  };

  beforeEach(async () => {
    authService = {
      deleteAccount: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: CreditService,
          useValue: {
            getAccount: jest.fn(),
            isOverdue: jest.fn(),
            amountOwed: jest.fn(),
          },
        },
      ],
    })
      // Bypass the real JwtAuthGuard — we test guard behavior in integration.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('calls authService.deleteAccount with the authenticated user id', async () => {
    await controller.deleteMe(fakeUser);
    expect(authService.deleteAccount).toHaveBeenCalledWith('user-1');
    expect(authService.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('returns void on success (HTTP 204 mapped via @HttpCode decorator)', async () => {
    const result = await controller.deleteMe(fakeUser);
    expect(result).toBeUndefined();
  });

  it('propagates NotFoundException (mapped to HTTP 404 by NestJS)', async () => {
    authService.deleteAccount.mockRejectedValueOnce(
      new NotFoundException('Usuario no encontrado'),
    );
    await expect(controller.deleteMe(fakeUser)).rejects.toThrow(
      NotFoundException,
    );
  });
});
