import {
  BadRequestException,
  Controller,
  forwardRef,
  Get,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreditService } from './credit.service';
import { PaymentsService } from '../payments/payments.service';

@UseGuards(JwtAuthGuard)
@Controller('me/credit')
export class MeCreditController {
  constructor(
    private readonly credit: CreditService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
  ) {}

  /**
   * GET /me/credit
   *
   * Any authenticated user may call this. If no credit_account exists,
   * returns 200 with null fields (NOT 404) — prevents front-end from needing
   * error handling for a common uninitialized state.
   */
  @Get()
  async getMyCredit(@CurrentUser() user: AuthenticatedUser) {
    const { account, recentMovements } = await this.credit.getMyCredit(user.id);

    if (!account) {
      return {
        balanceCents: null,
        creditLimitCents: null,
        dueDate: null,
        status: 'none' as const,
        amountOwedCents: 0,
        locked: false,
        movements: [],
      };
    }

    const overdue = this.credit.isOverdue(account);
    const status = overdue ? ('overdue' as const) : ('active' as const);
    const amountOwedCents = this.credit.amountOwed(account);

    return {
      balanceCents: account.balanceCents,
      creditLimitCents: account.creditLimitCents,
      dueDate: account.dueDate,
      status,
      amountOwedCents,
      // Total app lockout: credit is overdue AND the user owes money.
      locked: overdue && amountOwedCents > 0,
      movements: recentMovements,
    };
  }

  /**
   * POST /me/credit/payment-intent
   *
   * Creates a Stripe PaymentIntent for the caller to settle their outstanding
   * credit balance. The amount is derived server-side from the live balance —
   * the client cannot under-pay or over-pay arbitrary amounts.
   */
  @Post('payment-intent')
  async createPaymentIntent(@CurrentUser() user: AuthenticatedUser) {
    const account = await this.credit.getAccount(user.id);
    if (!account) {
      throw new BadRequestException({
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'No tenés cuenta de crédito',
      });
    }

    const amountCents = this.credit.amountOwed(account);
    if (amountCents <= 0) {
      throw new BadRequestException({
        code: 'CREDIT_NO_BALANCE',
        message: 'No tenés saldo pendiente',
      });
    }

    return this.payments.createCreditPaymentIntent({
      userId: user.id,
      amountCents,
    });
  }
}
