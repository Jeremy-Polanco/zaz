import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserAddress } from '../../entities/user-address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * List addresses for a user ordered by default first, then by created_at ASC.
   */
  async list(userId: string): Promise<UserAddress[]> {
    return this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  /**
   * Create a new address. Enforces 10-address cap.
   * First-ever address for a user is automatically set as default.
   * Throws 400 ADDRESS_CAP_EXCEEDED if the user already has 10 addresses.
   */
  async create(userId: string, dto: CreateAddressDto): Promise<UserAddress> {
    const count = await this.addresses.count({ where: { userId } });
    if (count >= 10) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ADDRESS_CAP_EXCEEDED',
        message: 'Solo puedes guardar hasta 10 direcciones',
      });
    }
    const isFirst = count === 0;
    const entity = this.addresses.create({
      ...dto,
      userId,
      isDefault: isFirst,
    });
    return this.addresses.save(entity);
  }

  /**
   * Update a user's address. Only whitelisted fields are applied.
   * isDefault is deliberately never set here — use setDefault() for that.
   * Throws 404 if the address doesn't exist or belongs to another user.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<UserAddress> {
    const addr = await this.addresses.findOne({ where: { id } });
    if (!addr || addr.userId !== userId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'ADDRESS_NOT_FOUND',
        message: 'Dirección no encontrada',
      });
    }
    // Defensive: apply only whitelisted fields — never copy isDefault through
    if (dto.label !== undefined) addr.label = dto.label;
    if (dto.line1 !== undefined) addr.line1 = dto.line1;
    if (dto.line2 !== undefined) addr.line2 = dto.line2 ?? null;
    if (dto.lat !== undefined) addr.lat = dto.lat;
    if (dto.lng !== undefined) addr.lng = dto.lng;
    if (dto.instructions !== undefined) addr.instructions = dto.instructions ?? null;
    return this.addresses.save(addr);
  }

  /**
   * Delete an address. If it was the default and other addresses remain,
   * promotes the most-recently-created remaining address to default.
   * Runs inside a transaction. Throws 404 if not found or wrong user.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(UserAddress);
      const target = await repo.findOne({ where: { id } });
      if (!target || target.userId !== userId) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'ADDRESS_NOT_FOUND',
          message: 'Dirección no encontrada',
        });
      }
      const wasDefault = target.isDefault;
      await repo.delete(id);
      if (wasDefault) {
        const next = await repo.findOne({
          where: { userId },
          order: { createdAt: 'DESC' },
        });
        if (next) {
          next.isDefault = true;
          await repo.save(next);
        }
      }
    });
  }

  /**
   * Promote an address to default. Inside a transaction:
   *   1) Clears is_default on all other addresses for this user.
   *   2) Sets is_default=true on the target.
   * Throws 404 if the address doesn't exist or belongs to another user.
   */
  async setDefault(userId: string, id: string): Promise<UserAddress> {
    return this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(UserAddress);
      const target = await repo.findOne({ where: { id } });
      if (!target || target.userId !== userId) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'ADDRESS_NOT_FOUND',
          message: 'Dirección no encontrada',
        });
      }
      await repo
        .createQueryBuilder()
        .update(UserAddress)
        .set({ isDefault: false })
        .where('user_id = :userId AND is_default = true', { userId })
        .execute();
      target.isDefault = true;
      return repo.save(target);
    });
  }

  /**
   * Super-admin variant: list any user's addresses.
   * No ownership check — the controller's RolesGuard handles authorization.
   */
  async listByUserId(targetUserId: string): Promise<UserAddress[]> {
    return this.list(targetUserId);
  }
}
