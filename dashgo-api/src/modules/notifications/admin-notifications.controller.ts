import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { BroadcastService } from './broadcast.service';
import {
  BROADCAST_AUDIENCES,
  BroadcastDto,
  type BroadcastAudience,
} from './dto/broadcast.dto';

/**
 * Manual push broadcast for the super admin (web panel → "Notificar").
 *
 *   GET  /admin/notifications/broadcast/preview?audience=all — reach counts
 *   POST /admin/notifications/broadcast — send to the selected audience
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN_DELIVERY)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly broadcast: BroadcastService) {}

  @Get('broadcast/preview')
  preview(@Query('audience') audience?: string) {
    const parsed: BroadcastAudience = (
      BROADCAST_AUDIENCES as readonly string[]
    ).includes(audience ?? '')
      ? (audience as BroadcastAudience)
      : 'all';
    return this.broadcast.preview(parsed);
  }

  @Post('broadcast')
  send(@Body() dto: BroadcastDto) {
    return this.broadcast.broadcast(dto.audience, dto.title, dto.body);
  }
}
