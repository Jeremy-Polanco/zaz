import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async getMe(user: AuthenticatedUser) {
    const me = await this.users.findOne({ where: { id: user.id } });
    if (!me) throw new NotFoundException();
    return me;
  }

  async updateMe(user: AuthenticatedUser, dto: UpdateMeDto) {
    await this.users.update(user.id, dto);
    return this.getMe(user);
  }

  async findAll(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException();
    }
    return this.users.find({ order: { createdAt: 'DESC' } });
  }
}
