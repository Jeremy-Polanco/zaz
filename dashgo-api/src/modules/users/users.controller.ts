import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../entities/enums';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import {
  TransferSellerPortfolioDto,
} from './dto/transfer-seller-portfolio.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getMe(user);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user, dto);
  }

  // El vendedor entra acá, pero `UsersService.findAll` le filtra la lista a su
  // propia cartera. La asignación (PATCH de abajo) sigue siendo del super admin.
  @Roles(UserRole.SUPER_ADMIN_DELIVERY, UserRole.SELLER)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.users.findAll(user, query);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Patch(':id')
  updateByAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserAdminDto,
  ) {
    return this.users.updateByAdmin(user, id, dto);
  }

  /**
   * Traspaso de cartera completa: todos los clientes de `:sellerId` pasan a
   * `toSellerId` (o quedan sin vendedor si viene `null`). Devuelve cuántos se
   * movieron.
   *
   * POST y no PATCH porque no edita el recurso de la URL: escribe N filas que
   * NO son `:sellerId` (su cartera). No choca con el `PATCH :id` / `DELETE :id`
   * de arriba — otro verbo y otro path, no hay ningún `POST :id` que lo tape.
   *
   * Solo el super admin, igual que la asignación de a uno: si un vendedor
   * pudiera correr esto se llevaría la cartera de otro en un solo request.
   */
  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Post('sellers/:sellerId/transfer')
  transferSellerPortfolio(
    @Param('sellerId', ParseUUIDPipe) sellerId: string,
    @Body() dto: TransferSellerPortfolioDto,
  ) {
    return this.users.transferSellerPortfolio(sellerId, dto.toSellerId);
  }

  /**
   * Super-admin hard-delete of a user. Returns 204 No Content on success.
   * Irreversible — runs the full account-deletion flow (anonymizes orders,
   * cascades related rows, writes a durable audit trail). An admin cannot
   * delete their own account here (403).
   */
  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteByAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.users.deleteByAdmin(user, id);
  }
}
