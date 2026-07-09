import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PushService } from './push.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

/**
 * Device push-token registry for the logged-in user.
 *
 *   POST   /me/push-tokens — register (idempotent upsert) after login/boot
 *   DELETE /me/push-tokens — unregister this device's token on logout
 */
@UseGuards(JwtAuthGuard)
@Controller('me/push-tokens')
export class MePushTokensController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.push.register(user.id, dto.token, dto.platform);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.push.unregister(user.id, dto.token);
  }
}
