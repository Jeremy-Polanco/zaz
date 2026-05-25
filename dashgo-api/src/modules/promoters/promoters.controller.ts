import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../entities/enums';
import { PromoterCommissionEntryStatus } from '../../entities';
import { PromotersService } from './promoters.service';
import { InvitePromoterDto } from './dto/invite-promoter.dto';
import { CreatePayoutDto } from './dto/create-payout.dto';

const VALID_COMMISSION_STATUS = new Set<string>([
  PromoterCommissionEntryStatus.PENDING,
  PromoterCommissionEntryStatus.CLAIMABLE,
  PromoterCommissionEntryStatus.PAID,
]);

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('promoters')
export class PromotersController {
  constructor(private readonly promoters: PromotersService) {}

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Post('invite')
  invite(@Body() dto: InvitePromoterDto) {
    return this.promoters.invite(dto);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get()
  findAll() {
    return this.promoters.getAll();
  }

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== UserRole.PROMOTER) {
      throw new ForbiddenException(
        'Solo promotores pueden ver sus estadísticas',
      );
    }
    return this.promoters.getMyStats(user.id);
  }

  @Get('me/dashboard')
  getMyDashboard(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== UserRole.PROMOTER) {
      throw new ForbiddenException('Solo promotores pueden ver su panel');
    }
    return this.promoters.getDashboardForPromoter(user.id);
  }

  @Get('me/commissions')
  getMyCommissions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (user.role !== UserRole.PROMOTER) {
      throw new ForbiddenException(
        'Solo promotores pueden ver sus comisiones',
      );
    }
    return this.promoters.getCommissionsForPromoter(user.id, {
      status: toStatus(status),
      page: parseIntSafe(page),
      pageSize: parseIntSafe(pageSize),
    });
  }

  @Get('me/payouts')
  getMyPayouts(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== UserRole.PROMOTER) {
      throw new ForbiddenException('Solo promotores pueden ver sus pagos');
    }
    return this.promoters.getMyPayouts(user.id);
  }

  @Public()
  @Get('by-code/:code')
  getByCode(@Param('code') code: string) {
    return this.promoters.getByCode(code);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get(':id/dashboard')
  getPromoterDashboard(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.promoters.getDashboardAsAdmin(id);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get(':id/commissions')
  getPromoterCommissions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.promoters.getCommissionsAsAdmin(id, {
      status: toStatus(status),
      page: parseIntSafe(page),
      pageSize: parseIntSafe(pageSize),
    });
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get(':id/payouts')
  getPromoterPayouts(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.promoters.getPayouts(id);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Post(':id/payout')
  createPayout(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutDto,
  ) {
    return this.promoters.createPayout(id, user.id, dto.notes ?? null);
  }
}

function toStatus(value?: string): PromoterCommissionEntryStatus | undefined {
  if (!value) return undefined;
  if (!VALID_COMMISSION_STATUS.has(value)) return undefined;
  return value as PromoterCommissionEntryStatus;
}

function parseIntSafe(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}
