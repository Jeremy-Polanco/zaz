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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/**
 * Client-facing address management endpoints.
 * All routes are JWT-guarded; ownership is enforced at the service layer.
 *
 * Routes:
 *   GET    /me/addresses              — list own addresses
 *   POST   /me/addresses              — create a new address
 *   PATCH  /me/addresses/:id          — update label/line1/line2/lat/lng/instructions
 *   DELETE /me/addresses/:id          — delete address (promotes default if needed)
 *   PATCH  /me/addresses/:id/set-default — promote address to default
 */
@UseGuards(JwtAuthGuard)
@Controller('me/addresses')
export class MeAddressesController {
  constructor(private readonly service: AddressesService) {}

  /**
   * GET /me/addresses
   * Returns the authenticated user's addresses ordered by default first, then created_at ASC.
   */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }

  /**
   * POST /me/addresses
   * Creates a new address. First address auto-defaults. Enforces 10-address cap.
   * Returns 201 with the created address.
   */
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ) {
    return this.service.create(user.id, dto);
  }

  /**
   * PATCH /me/addresses/:id/set-default
   * Promotes the address to default (clears is_default on all others).
   * NOTE: this route MUST be declared BEFORE PATCH ':id' so Express/Fastify
   * doesn't match 'set-default' as the :id parameter.
   * Returns 200 with the updated address.
   */
  @Patch(':id/set-default')
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.setDefault(user.id, id);
  }

  /**
   * PATCH /me/addresses/:id
   * Updates whitelisted fields (label, line1, line2, lat, lng, instructions).
   * isDefault cannot be changed via this endpoint.
   * Returns 200 with the updated address.
   */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  /**
   * DELETE /me/addresses/:id
   * Deletes the address. If it was default and others remain, promotes most recent.
   * Returns 204 No Content.
   */
  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete(user.id, id);
  }
}
