import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { decorateProduct, ProductWithPricing } from './pricing';

export type ProductForClient = Omit<ProductWithPricing, 'imageBytes'>;

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /** Catálogo público — productos disponibles. */
  async findAllPublic(): Promise<ProductForClient[]> {
    const rows = await this.products.find({
      where: { isAvailable: true },
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return rows.map((p) => this.toClient(p, now));
  }

  /** Catálogo editable (super admin) — todos los productos. */
  async findAllForAdmin(user: AuthenticatedUser): Promise<ProductForClient[]> {
    this.assertSuperAdmin(user);
    const rows = await this.products.find({
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return rows.map((p) => this.toClient(p, now));
  }

  async findOne(id: string): Promise<Product> {
    const p = await this.products.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    const product = this.products.create({
      name: dto.name,
      description: dto.description ?? null,
      priceToPublic: String(dto.priceToPublic),
      isAvailable: true,
      stock: dto.stock ?? 0,
      promoterCommissionPct:
        dto.promoterCommissionPct !== undefined
          ? String(dto.promoterCommissionPct)
          : '0',
      pointsPct: dto.pointsPct !== undefined ? String(dto.pointsPct) : '1.00',
      categoryId: dto.categoryId ?? null,
      offerLabel: dto.offerLabel ?? null,
      offerDiscountPct:
        dto.offerDiscountPct != null ? String(dto.offerDiscountPct) : null,
      offerStartsAt: dto.offerStartsAt ? new Date(dto.offerStartsAt) : null,
      offerEndsAt: dto.offerEndsAt ? new Date(dto.offerEndsAt) : null,
    });
    const saved = await this.products.save(product);
    const full = await this.findOne(saved.id);
    return this.toClient(full);
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    dto: UpdateProductDto,
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    const p = await this.findOne(id);
    const patch: Partial<Product> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.priceToPublic !== undefined)
      patch.priceToPublic = String(dto.priceToPublic);
    if (dto.promoterCommissionPct !== undefined)
      patch.promoterCommissionPct = String(dto.promoterCommissionPct);
    if (dto.pointsPct !== undefined) patch.pointsPct = String(dto.pointsPct);
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.offerLabel !== undefined) patch.offerLabel = dto.offerLabel;
    if (dto.offerDiscountPct !== undefined) {
      patch.offerDiscountPct =
        dto.offerDiscountPct == null ? null : String(dto.offerDiscountPct);
    }
    if (dto.offerStartsAt !== undefined) {
      patch.offerStartsAt = dto.offerStartsAt
        ? new Date(dto.offerStartsAt)
        : null;
    }
    if (dto.offerEndsAt !== undefined) {
      patch.offerEndsAt = dto.offerEndsAt ? new Date(dto.offerEndsAt) : null;
    }
    if (Object.keys(patch).length > 0) {
      await this.products.update(p.id, patch);
    }
    const full = await this.findOne(id);
    return this.toClient(full);
  }

  async remove(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    this.assertSuperAdmin(user);
    const p = await this.findOne(id);
    await this.products.remove(p);
    return { deleted: true };
  }

  /** Actualiza disponibilidad / stock del producto global. */
  async updateInventory(
    id: string,
    dto: UpdateInventoryDto,
    user: AuthenticatedUser,
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    const p = await this.findOne(id);
    const patch: Partial<Product> = {};
    if (dto.isAvailable !== undefined) patch.isAvailable = dto.isAvailable;
    if (dto.stock !== undefined) patch.stock = dto.stock;
    if (Object.keys(patch).length > 0) {
      await this.products.update(p.id, patch);
    }
    const full = await this.findOne(id);
    return this.toClient(full);
  }

  async uploadImage(
    id: string,
    user: AuthenticatedUser,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Imagen excede 5MB');
    }
    const p = await this.findOne(id);
    await this.products.update(p.id, {
      imageBytes: file.buffer,
      imageContentType: file.mimetype,
      imageUpdatedAt: new Date(),
    });
    const full = await this.findOne(id);
    return this.toClient(full);
  }

  async getImage(
    id: string,
  ): Promise<{ buffer: Buffer; contentType: string; updatedAt: Date | null }> {
    const row = await this.products
      .createQueryBuilder('p')
      .addSelect('p.image_bytes', 'p_image_bytes')
      .where('p.id = :id', { id })
      .getRawAndEntities();
    if (!row.entities[0]) throw new NotFoundException('Producto no encontrado');
    const bytes: Buffer | null = row.raw[0]?.p_image_bytes ?? null;
    const contentType = row.entities[0].imageContentType;
    if (!bytes || !contentType) {
      throw new NotFoundException('Producto sin imagen');
    }
    return {
      buffer: bytes,
      contentType,
      updatedAt: row.entities[0].imageUpdatedAt,
    };
  }

  private toClient(p: Product, now: Date = new Date()): ProductForClient {
    const decorated = decorateProduct(p, now);
    const { imageBytes, ...rest } = decorated;
    void imageBytes;
    return rest;
  }

  private assertSuperAdmin(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException('Solo super admin puede gestionar productos');
    }
  }
}
