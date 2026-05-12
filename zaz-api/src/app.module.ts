import {
  Module,
  OnApplicationBootstrap,
  NestModule,
  MiddlewareConsumer,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { envSchema } from './config/env.schema';
import { buildDatabaseConfig } from './config/database.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PromotersModule } from './modules/promoters/promoters.module';
import { PointsModule } from './modules/points/points.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { CreditModule } from './modules/credit/credit.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { HealthController } from './health/health.controller';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildDatabaseConfig(config),
    }),
    PromotersModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CategoriesModule,
    OrdersModule,
    PaymentsModule,
    PointsModule,
    InvoicesModule,
    ShippingModule,
    CreditModule,
    SubscriptionModule,
    AddressesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements OnApplicationBootstrap, NestModule {
  constructor(private readonly dataSource: DataSource) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }

  async onApplicationBootstrap() {
    await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  }
}
