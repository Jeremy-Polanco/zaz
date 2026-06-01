import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpCode, User } from '../../entities';
import { Order } from '../../entities/order.entity';
import { UserAddress } from '../../entities/user-address.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Rental } from '../../entities/rental.entity';
import { CreditAccount } from '../../entities/credit-account.entity';
import { PromoterCommissionEntry } from '../../entities/promoter-commission-entry.entity';
import { Payout } from '../../entities/payout.entity';
import { PointsLedgerEntry } from '../../entities/points-ledger-entry.entity';
import { AccountDeletion } from '../../entities/account-deletion.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TwilioModule } from '../twilio/twilio.module';
import { PromotersModule } from '../promoters/promoters.module';
import { CreditModule } from '../credit/credit.module';

@Module({
  imports: [
    // Repositories injected into AuthService for FIX C2 (account deletion):
    // Order/UserAddress/Subscription/Rental/CreditAccount/PromoterCommissionEntry/
    // Payout/PointsLedgerEntry. The deletion service touches these tables
    // directly inside a single transaction so a partial failure rolls back.
    TypeOrmModule.forFeature([
      User,
      OtpCode,
      Order,
      UserAddress,
      Subscription,
      Rental,
      CreditAccount,
      PromoterCommissionEntry,
      Payout,
      PointsLedgerEntry,
      AccountDeletion,
    ]),
    PassportModule,
    TwilioModule,
    PromotersModule,
    CreditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_TTL', '1h'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
