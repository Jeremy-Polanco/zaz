import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/enums';

/**
 * One-off — promote (or provision) a delivery admin by phone.
 *
 * If a user with the phone already exists, their role is set to
 * SUPER_ADMIN_DELIVERY (AUTH_BOOTSTRAP_ADMIN_PHONES only applies to brand-new
 * signups, so existing accounts need this script). If no user exists, one is
 * created so the person lands on the delivery panel on their first OTP login.
 *
 * Idempotent — re-running against an already-promoted user is a no-op.
 * The role lives inside the JWT, so an already-logged-in user must log out
 * and back in to pick up the new role.
 *
 * Run (local):  npm run admin:delivery -- +12019081426 "Nombre Apellido"
 * Run (prod, DO console):  node dist/database/make-delivery-admin.js +12019081426 "Nombre Apellido"
 */
async function run() {
  const logger = new Logger('MakeDeliveryAdmin');
  const phone = (process.argv[2] ?? '').trim();
  const fullName = (process.argv[3] ?? '').trim();

  if (!/^\+\d{8,15}$/.test(phone)) {
    console.error(
      'Usage: make-delivery-admin <phone E.164> [fullName]\n' +
        'Example: node dist/database/make-delivery-admin.js +12019081426 "Juan Pérez"',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const users = app.get(DataSource).getRepository(User);
    const existing = await users.findOne({ where: { phone } });

    if (existing) {
      if (existing.role === UserRole.SUPER_ADMIN_DELIVERY) {
        logger.log(
          `${phone} (${existing.fullName}) ya es SUPER_ADMIN_DELIVERY — nada que hacer.`,
        );
        return;
      }
      const previousRole = existing.role;
      existing.role = UserRole.SUPER_ADMIN_DELIVERY;
      if (fullName) existing.fullName = fullName;
      await users.save(existing);
      logger.warn(
        `${phone} (${existing.fullName}) promovido: ${previousRole} → super_admin_delivery. ` +
          'Debe cerrar sesión y volver a entrar para que el token tome el rol nuevo.',
      );
      return;
    }

    const created = await users.save(
      users.create({
        phone,
        fullName: fullName || 'Repartidor',
        email: null,
        role: UserRole.SUPER_ADMIN_DELIVERY,
      }),
    );
    logger.warn(
      `Usuario nuevo ${created.id} creado con ${phone} como super_admin_delivery. ` +
        'Al entrar con OTP con ese número ya cae en el panel de reparto.',
    );
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('make-delivery-admin failed:', err);
  process.exit(1);
});
