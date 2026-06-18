import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/**
 * Super-admin endpoints for managing a user's saved addresses.
 * All routes require SUPER_ADMIN_DELIVERY role.
 *
 * Routes:
 *   GET    /admin/users/:userId/addresses — list target user's addresses
 *   POST   /admin/users/:userId/addresses — save a new address for the user
 *   PATCH  /admin/users/:userId/addresses/:id — update whitelisted fields
 *   PATCH  /admin/users/:userId/addresses/:id/set-default — promote to default
 *   DELETE /admin/users/:userId/addresses/:id — delete (promotes default if needed)
 *
 * The colmado owns location data: customers never enter addresses themselves;
 * the super-admin captures the location at delivery and saves it here.
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

  /**
   * POST /admin/users/:userId/addresses
   * Saves a new address for the target user (first one auto-defaults; 10-cap
   * enforced by the service). Returns 201 with the created address.
   */
  @Post(':userId/addresses')
  createForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateAddressDto,
  ) {
    return this.service.create(userId, dto);
  }

  /**
   * PATCH /admin/users/:userId/addresses/:id/set-default
   * Promotes the target user's address to default (clears the others).
   * MUST be declared before PATCH ':id' so 'set-default' isn't matched as :id.
   * Returns 200 with the updated address.
   */
  @Patch(':userId/addresses/:id/set-default')
  setDefaultForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.setDefault(userId, id);
  }

  /**
   * PATCH /admin/users/:userId/addresses/:id
   * Updates whitelisted fields (label, line1, line2, building, lat, lng,
   * instructions). isDefault cannot be changed here. Returns 200.
   */
  @Patch(':userId/addresses/:id')
  updateForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.service.update(userId, id, dto);
  }

  /**
   * DELETE /admin/users/:userId/addresses/:id
   * Deletes the address (promotes the most recent remaining one if it was
   * default). Returns 204 No Content.
   */
  @Delete(':userId/addresses/:id')
  @HttpCode(204)
  async deleteForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete(userId, id);
  }
}
