import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RentalsService } from './rentals.service';
import { CustomerRentalResponseDto } from './dto/customer-rental-response.dto';

/**
 * Customer-facing rental endpoints.
 * All routes are JWT-guarded; scope (userId) is derived from the JWT.
 *
 * Routes:
 *   GET /me/rentals — list authenticated user's own rentals
 */
@UseGuards(JwtAuthGuard)
@Controller('me/rentals')
export class MeRentalsController {
  constructor(private readonly rentals: RentalsService) {}

  /**
   * GET /me/rentals
   * Returns the authenticated user's rental list.
   * Only the caller's own rentals are returned (scope enforced at service layer).
   */
  @Get()
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomerRentalResponseDto[]> {
    return this.rentals.listMine(user.id);
  }
}
