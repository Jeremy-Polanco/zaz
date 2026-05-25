import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../entities/enums';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Catálogo público (cualquier usuario autenticado). */
  @Get()
  findAll() {
    return this.products.findAllPublic();
  }

  /** Catálogo completo para super admin. */
  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get('admin')
  findAllAdmin(@CurrentUser() user: AuthenticatedUser) {
    return this.products.findAllForAdmin(user);
  }

  @Public()
  @Get(':id/image')
  @Header('Cache-Control', 'public, max-age=300')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType, updatedAt } = await this.products.getImage(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length.toString());
    if (updatedAt) res.setHeader('Last-Modified', updatedAt.toUTCString());
    res.end(buffer);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(user, dto);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, user, dto);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Patch(':id/inventory')
  updateInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.products.updateInventory(id, dto, user);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.products.remove(id, user);
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.products.uploadImage(id, user, file);
  }
}
