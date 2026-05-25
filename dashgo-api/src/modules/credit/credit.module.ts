import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditAccount, CreditMovement, Order } from '../../entities';
import { CreditService } from './credit.service';
import { AdminCreditController } from './admin-credit.controller';
import { MeCreditController } from './me-credit.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CreditAccount, CreditMovement, Order]),
    forwardRef(() => PaymentsModule),
  ],
  providers: [CreditService],
  controllers: [AdminCreditController, MeCreditController],
  exports: [CreditService],
})
export class CreditModule {}
