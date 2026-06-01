import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PhoneThrottlerGuard } from '../../common/guards/phone-throttler.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreditService } from '../credit/credit.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credit: CreditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body('refreshToken') token: string) {
    return this.auth.refresh(token);
  }

  @Public()
  @UseGuards(PhoneThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('otp/send')
  sendOtp(
    @Body() dto: SendOtpDto,
    @Headers('x-dashgo-e2e') e2eHeader?: string,
  ) {
    // E2E header lets Playwright bypass the 30s per-phone cooldown so a
    // multi-file suite can drive several different phones without sleeps.
    // Gated by NODE_ENV in the service-level guard would be cleaner, but
    // the cooldown is in service so we pass an explicit flag.
    const skipCooldown = !!e2eHeader && process.env.NODE_ENV !== 'production';
    return this.auth.sendOtp(dto, { skipCooldown });
  }

  @Public()
  @UseGuards(PhoneThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const account = await this.credit.getAccount(user.id);
    const creditLocked = account
      ? this.credit.isOverdue(account) && this.credit.amountOwed(account) > 0
      : false;
    return { ...user, creditLocked };
  }

  /**
   * FIX C2 — Account deletion (Apple Guideline 5.1.1(v)).
   *
   * Returns 204 No Content on success. The auth token used to call this
   * endpoint is immediately invalidated at the database level (user row is
   * gone, so the next request fails the JwtAuthGuard lookup).
   *
   * Errors:
   *   - 401 if the request is unauthenticated (JwtAuthGuard).
   *   - 404 if the user backing the token has already been deleted (race
   *     between two concurrent delete calls — AuthService throws
   *     NotFoundException).
   */
  @UseGuards(JwtAuthGuard)
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.deleteAccount(user.id);
  }
}
