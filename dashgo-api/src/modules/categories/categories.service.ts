import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Category } from '../../entities';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  async findAll(): Promise<(Category & { imageUrl: string | null })[]> {
    const rows = await this.categories.find({
      order: { displayOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((c) => ({
      ...c,
      imageUrl: c.imageUpdatedAt
        ? `/categories/${c.id}/image?t=${c.imageUpdatedAt.getTime()}`
        : null,
    }));
  }

  async findOne(id: string): Promise<Category> {
    const cat = await this.categories.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    return cat;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateCategoryDto,
  ): Promise<Category> {
    this.assertSuperAdmin(user);
    const name = dto.name.trim();
    const slug = (dto.slug ?? slugify(name)).trim();
    if (!slug) {
      throw new ConflictException('No se pudo generar un slug válido');
    }
    const existing = await this.categories.findOne({
      where: [{ name }, { slug }],
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe una categoría con ese nombre o slug',
      );
    }
    const cat = this.categories.create({
      name,
      slug,
      iconEmoji: dto.iconEmoji ?? null,
      displayOrder: dto.displayOrder ?? 0,
    });
    return this.categories.save(cat);
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    this.assertSuperAdmin(user);
    const cat = await this.findOne(id);
    const patch: Partial<Category> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) patch.slug = dto.slug.trim();
    if (dto.iconEmoji !== undefined) patch.iconEmoji = dto.iconEmoji || null;
    if (dto.displayOrder !== undefined) patch.displayOrder = dto.displayOrder;

    if (patch.name || patch.slug) {
      const conflicts = await this.categories.find({
        where: [
          ...(patch.name
            ? [{ name: patch.name, id: Not(id) }]
            : []),
          ...(patch.slug
            ? [{ slug: patch.slug, id: Not(id) }]
            : []),
        ],
      });
      if (conflicts.length > 0) {
        throw new ConflictException(
          'Ya existe una categoría con ese nombre o slug',
        );
      }
    }

    if (Object.keys(patch).length > 0) {
      await this.categories.update(cat.id, patch);
    }
    return this.findOne(id);
  }

  async remove(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    this.assertSuperAdmin(user);
    const cat = await this.findOne(id);
    await this.categories.remove(cat);
    return { deleted: true };
  }

  async uploadImage(
    id: string,
    user: AuthenticatedUser,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<Category & { imageUrl: string | null }> {
    this.assertSuperAdmin(user);
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Imagen excede 5MB');
    }
    const cat = await this.findOne(id);
    await this.categories.update(cat.id, {
      imageBytes: file.buffer,
      imageContentType: file.mimetype,
      imageUpdatedAt: new Date(),
    });
    const full = await this.findOne(id);
    return {
      ...full,
      imageUrl: full.imageUpdatedAt
        ? `/categories/${full.id}/image?t=${full.imageUpdatedAt.getTime()}`
        : null,
    };
  }

  async getImage(
    id: string,
  ): Promise<{ buffer: Buffer; contentType: string; updatedAt: Date | null }> {
    const row = await this.categories
      .createQueryBuilder('c')
      .addSelect('c.image_bytes', 'c_image_bytes')
      .where('c.id = :id', { id })
      .getRawAndEntities();
    if (!row.entities[0]) throw new NotFoundException('Categoría no encontrada');
    const bytes: Buffer | null = row.raw[0]?.c_image_bytes ?? null;
    const contentType = row.entities[0].imageContentType;
    if (!bytes || !contentType) {
      throw new NotFoundException('Categoría sin imagen');
    }
    return {
      buffer: bytes,
      contentType,
      updatedAt: row.entities[0].imageUpdatedAt,
    };
  }

  private assertSuperAdmin(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException(
        'Solo super admin puede gestionar categorías',
      );
    }
  }
}
