import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { AddressesService } from './addresses.service';

/**
 * Super-admin endpoints for viewing a user's saved addresses.
 * All routes require SUPER_ADMIN_DELIVERY role.
 *
 * Routes:
 *   GET /admin/users/:userId/addresses — list target user's addresses (read-only)
 *
 * NOTE: No write endpoints. POST/PATCH/DELETE under this prefix are intentionally
 * absent — they will return 404 from NestJS default not-found handler.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN_DELIVERY)
@Controller('admin/users')
export class AdminAddressesController {
  constructor(private readonly service: AddressesService) {}

  /**
   * GET /admin/users/:userId/addresses
   * Returns the target user's addresses in default-first, created_at ASC order.
   * Returns 200 [] for a userId with no addresses (including non-existent users).
   * Returns 400 if userId is not a valid UUID.
   */
  @Get(':userId/addresses')
  listForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.service.listByUserId(userId);
  }
}
