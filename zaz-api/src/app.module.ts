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
import * as Joi from 'joi';
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
import { HealthController } from './health/health.controller';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        // Database
        DB_HOST: Joi.string().default('localhost'),
        DB_PORT: Joi.number().default(5432),
        DB_USER: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_NAME: Joi.string().required(),
        DB_SYNCHRONIZE: Joi.string()
          .valid('true', 'false')
          .default('false')
          .when(Joi.ref('NODE_ENV'), {
            is: 'production',
            then: Joi.valid('false').default('false'),
          }),
        DB_POOL_MAX: Joi.number().default(20),
        // SSL: 'true' for managed Postgres (DO/Render/Neon/Supabase), 'ca' to verify
        // against a CA bundle from DB_SSL_CA, 'false' for local docker-compose.
        DB_SSL: Joi.string().valid('true', 'false', 'ca').default('false'),
        DB_SSL_CA: Joi.string().when('DB_SSL', {
          is: 'ca',
          then: Joi.required(),
        }),
        // Auth
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_TTL: Joi.string().default('1h'),
        JWT_REFRESH_TTL: Joi.string().default('7d'),
        // Stripe
        STRIPE_SECRET_KEY: Joi.string().required(),
        STRIPE_WEBHOOK_SECRET: Joi.string().required(),
        STRIPE_SUBSCRIPTION_PRICE_ID: Joi.string().when('NODE_ENV', {
          is: 'production',
          then: Joi.required(),
        }),
        // Twilio
        TWILIO_ACCOUNT_SID: Joi.string().required(),
        TWILIO_API_KEY_SID: Joi.string().required(),
        TWILIO_API_KEY_SECRET: Joi.string().required(),
        TWILIO_FROM_NUMBER: Joi.string().required(),
        // Auth bypass — comma-separated list of E.164 phones that skip the
        // Twilio call and accept AUTH_BYPASS_OTP_CODE as their OTP. Temporary
        // workaround until A2P 10DLC is registered or Twilio Verify is wired in.
        // LEAVE EMPTY in production once Verify is live.
        AUTH_BYPASS_PHONES: Joi.string().allow('').default(''),
        AUTH_BYPASS_OTP_CODE: Joi.string().length(6).default('000000'),
        // Comma-separated phones that get SUPER_ADMIN_DELIVERY role on FIRST
        // creation. Existing users are NOT auto-promoted — change roles in DB.
        AUTH_BOOTSTRAP_ADMIN_PHONES: Joi.string().allow('').default(''),
        // App
        CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
        API_PORT: Joi.number().default(3001),
        PUBLIC_WEB_URL: Joi.string().default('http://localhost:5173'),
        // Sentry — optional. When set, errors get reported.
        SENTRY_DSN: Joi.string().uri().optional().allow(''),
        SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
      }),
      validationOptions: { abortEarly: false },
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
