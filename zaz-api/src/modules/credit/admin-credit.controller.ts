import {
  Body,
  ConflictException,
  Controller,
  Get,
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
import { CreditService } from './credit.service';
import { AdjustCreditDto } from './dto/adjust-credit.dto';
import { GrantCreditDto } from './dto/grant-credit.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { ManualAdjustmentDto } from './dto/manual-adjustment.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN_DELIVERY)
@Controller('admin/credit-accounts')
export class AdminCreditController {
  constructor(private readonly credit: CreditService) {}

  /** GET /admin/credit-accounts — paginated + filtered list */
  @Get()
  listAccounts(@Query() query: ListAccountsQueryDto) {
    return this.credit.listAccounts(query);
  }

  /** GET /admin/credit-accounts/:userId — account + last 50 movements */
  @Get(':userId')
  async getAccount(@Param('userId', ParseUUIDPipe) userId: string) {
    const account = await this.credit.getAccount(userId);
    const movements = await this.credit.getMovements(userId, 1, 50);
    return { account, movements };
  }

  /** GET /admin/credit-accounts/:userId/movements — paginated history */
  @Get(':userId/movements')
  getMovements(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.credit.getMovements(userId, Number(page), Number(pageSize));
  }

  /** POST /admin/credit-accounts/:userId — upsert (idempotent create) */
  @Post(':userId')
  createAccount(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.credit.getOrCreateAccount(userId);
  }

  /** POST /admin/credit-accounts/:userId/grant */
  @Post(':userId/grant')
  grantCredit(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantCreditDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : undefined;
    return this.credit.grantCredit(
      userId,
      dto.amountCents,
      actor.id,
      dto.note,
      dueDate,
    );
  }

  /** POST /admin/credit-accounts/:userId/payment */
  @Post(':userId/payment')
  recordPayment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.credit.recordPayment(userId, dto.amountCents, actor.id, dto.note);
  }

  /**
   * POST /admin/credit-accounts/:userId/refund/:orderId
   * Returns 409 if a reversal already exists (idempotency guard).
   */
  @Post(':userId/refund/:orderId')
  async refundOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const result = await this.credit.reverseCharge(orderId);
    if (result === null) {
      throw new ConflictException({
        code: 'CREDIT_DEDUP',
        message: 'Ya existe una reversión para este pedido',
      });
    }
    return result;
  }

  /** POST /admin/credit-accounts/:userId/adjustment */
  @Post(':userId/adjustment')
  manualAdjustment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ManualAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.credit.manualAdjustment(
      userId,
      dto.amountCents,
      actor.id,
      dto.note,
    );
  }

  /** PATCH /admin/credit-accounts/:userId — adjust limit and/or due date */
  @Patch(':userId')
  async adjustCredit(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdjustCreditDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const results: unknown[] = [];

    if (dto.newLimitCents !== undefined) {
      const r = await this.credit.adjustLimit(userId, dto.newLimitCents, actor.id);
      results.push(r);
    }

    if ('dueDate' in dto) {
      const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      const r = await this.credit.setDueDate(userId, dueDate, actor.id);
      results.push(r);
    }

    // Return the final account state
    return this.credit.getAccount(userId);
  }
}
