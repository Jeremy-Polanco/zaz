import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
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
}
