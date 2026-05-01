import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PointsService } from './points.service';

@UseGuards(JwtAuthGuard)
@Controller('points')
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get('balance')
  async getBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.points.getBalance(user.id);
  }

  @Get('history')
  async getHistory(@CurrentUser() user: AuthenticatedUser) {
    const entries = await this.points.getHistory(user.id);
    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      amountCents: e.amountCents,
      orderId: e.orderId,
      claimableAt: e.claimableAt,
      expiresAt: e.expiresAt,
      createdAt: e.createdAt,
    }));
  }
}
