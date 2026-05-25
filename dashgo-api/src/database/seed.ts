import 'reflect-metadata';
import { AppDataSource } from './data-source';
import {
  Category,
  CreditAccount,
  CreditMovement,
  CreditMovementType,
  PointsEntryStatus,
  PointsEntryType,
  PointsLedgerEntry,
  Product,
  PromoterCommissionEntry,
  PromoterCommissionEntryStatus,
  PromoterCommissionEntryType,
  User,
} from '../entities';
import { UserRole } from '../entities/enums';

async function run() {
  await AppDataSource.initialize();
  await AppDataSource.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await AppDataSource.query(
    'TRUNCATE TABLE credit_movement, credit_account, promoter_commission_entries, payouts, invoices, points_ledger_entries, counters, order_items, orders, products, categories, users RESTART IDENTITY CASCADE',
  );

  const userRepo = AppDataSource.getRepository(User);
  const categoryRepo = AppDataSource.getRepository(Category);
  const productRepo = AppDataSource.getRepository(Product);
  const ledgerRepo = AppDataSource.getRepository(PointsLedgerEntry);
  const commRepo = AppDataSource.getRepository(PromoterCommissionEntry);
  const creditAccountRepo = AppDataSource.getRepository(CreditAccount);
  const creditMovementRepo = AppDataSource.getRepository(CreditMovement);

  console.log('Seeding users…');
  const superAdmin = await userRepo.save(
    userRepo.create({
      phone: '+15555550001',
      fullName: 'Super Admin',
      email: null,
      role: UserRole.SUPER_ADMIN_DELIVERY,
      addressDefault: {
        text: 'Depósito central — Bronx, NY',
        lat: 40.8448,
        lng: -73.8648,
      },
    }),
  );

  const promoter = await userRepo.save(
    userRepo.create({
      phone: '+15555550005',
      fullName: 'Promoter Demo',
      email: null,
      role: UserRole.PROMOTER,
      referralCode: 'DEMO123A',
    }),
  );

  const client = await userRepo.save(
    userRepo.create({
      phone: '+15555550004',
      fullName: 'Cliente Demo',
      email: null,
      role: UserRole.CLIENT,
      addressDefault: {
        text: '150 W 145th St, New York, NY 10039',
        lat: 40.8221,
        lng: -73.9407,
      },
      referredById: promoter.id,
    }),
  );

  const clientAlDia = await userRepo.save(
    userRepo.create({
      phone: '+15555550006',
      fullName: 'María Pérez',
      email: null,
      role: UserRole.CLIENT,
      addressDefault: {
        text: '301 E 161st St, Bronx, NY 10451',
        lat: 40.8268,
        lng: -73.9239,
      },
    }),
  );

  const clientVencido = await userRepo.save(
    userRepo.create({
      phone: '+15555550007',
      fullName: 'Juan Rodríguez',
      email: null,
      role: UserRole.CLIENT,
      addressDefault: {
        text: '2520 Grand Concourse, Bronx, NY 10458',
        lat: 40.8625,
        lng: -73.8975,
      },
    }),
  );

  console.log('Seeding cuentas de crédito (fiado)…');
  const now = Date.now();
  const inFifteenDays = new Date(now + 15 * 24 * 3600 * 1000);
  const fiveDaysAgo = new Date(now - 5 * 24 * 3600 * 1000);

  // Cliente Demo → sin-deuda (limit $50, balance 0)
  await creditAccountRepo.save(
    creditAccountRepo.create({
      userId: client.id,
      balanceCents: 0,
      creditLimitCents: 5000,
      dueDate: null,
      currency: 'usd',
    }),
  );

  // María Pérez → al-dia (debe $15, due en 15 días)
  await creditAccountRepo.save(
    creditAccountRepo.create({
      userId: clientAlDia.id,
      balanceCents: -1500,
      creditLimitCents: 5000,
      dueDate: inFifteenDays,
      currency: 'usd',
    }),
  );

  // Juan Rodríguez → vencido (debe $25, due hace 5 días)
  await creditAccountRepo.save(
    creditAccountRepo.create({
      userId: clientVencido.id,
      balanceCents: -2500,
      creditLimitCents: 5000,
      dueDate: fiveDaysAgo,
      currency: 'usd',
    }),
  );

  await creditMovementRepo.save([
    creditMovementRepo.create({
      creditAccountId: clientAlDia.id,
      type: CreditMovementType.GRANT,
      amountCents: 5000,
      orderId: null,
      performedByUserId: superAdmin.id,
      note: 'Apertura de cuenta — límite inicial',
    }),
    creditMovementRepo.create({
      creditAccountId: clientAlDia.id,
      type: CreditMovementType.CHARGE,
      amountCents: 1500,
      orderId: null,
      performedByUserId: null,
      note: 'Compra a fiado — 2 galones',
    }),
    creditMovementRepo.create({
      creditAccountId: clientVencido.id,
      type: CreditMovementType.GRANT,
      amountCents: 5000,
      orderId: null,
      performedByUserId: superAdmin.id,
      note: 'Apertura de cuenta — límite inicial',
    }),
    creditMovementRepo.create({
      creditAccountId: clientVencido.id,
      type: CreditMovementType.CHARGE,
      amountCents: 2500,
      orderId: null,
      performedByUserId: null,
      note: 'Compra a fiado — pack semanal',
    }),
  ]);

  console.log('Seeding categorías…');
  const [agua, bebidas, hielo, accesorios] = await categoryRepo.save([
    categoryRepo.create({
      name: 'Agua',
      slug: 'agua',
      iconEmoji: '💧',
      displayOrder: 1,
    }),
    categoryRepo.create({
      name: 'Bebidas',
      slug: 'bebidas',
      iconEmoji: '🥤',
      displayOrder: 2,
    }),
    categoryRepo.create({
      name: 'Hielo',
      slug: 'hielo',
      iconEmoji: '🧊',
      displayOrder: 3,
    }),
    categoryRepo.create({
      name: 'Accesorios',
      slug: 'accesorios',
      iconEmoji: '📦',
      displayOrder: 4,
    }),
  ]);
  void accesorios;

  console.log('Seeding catálogo global…');
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  await productRepo.save([
    productRepo.create({
      name: 'Galón Planeta Azul 5gal',
      description: 'Agua purificada, galón retornable de 5 galones.',
      priceToPublic: '7.50',
      isAvailable: true,
      stock: 100,
      categoryId: agua.id,
      pointsPct: '1.00',
      promoterCommissionPct: '5.00',
    }),
    productRepo.create({
      name: 'Garrafón 2.5gal',
      description: 'Medio galón retornable.',
      priceToPublic: '4.50',
      isAvailable: true,
      stock: 80,
      categoryId: agua.id,
      pointsPct: '1.00',
      promoterCommissionPct: '5.00',
    }),
    productRepo.create({
      name: 'Botellón 5L',
      description: 'Botellón 5 litros — listo para dispenser.',
      priceToPublic: '2.50',
      isAvailable: true,
      stock: 150,
      categoryId: agua.id,
      pointsPct: '1.00',
      promoterCommissionPct: '3.00',
      offerLabel: '¡Promo lanzamiento!',
      offerDiscountPct: '15.00',
      offerStartsAt: null,
      offerEndsAt: thirtyDaysFromNow,
    }),
    productRepo.create({
      name: 'Pack 6x 500ml',
      description: 'Seis botellas de 500 ml para la nevera.',
      priceToPublic: '3.00',
      isAvailable: true,
      stock: 60,
      categoryId: bebidas.id,
      pointsPct: '2.00',
      promoterCommissionPct: '4.00',
    }),
    productRepo.create({
      name: 'Hielera 10lb',
      description: 'Bolsa de hielo 10 libras.',
      priceToPublic: '5.00',
      isAvailable: true,
      stock: 40,
      categoryId: hielo.id,
      pointsPct: '1.00',
      promoterCommissionPct: '3.00',
    }),
  ]);

  console.log('Seeding puntos históricos CLAIMABLE para cliente demo…');
  await ledgerRepo.save(
    ledgerRepo.create({
      userId: client.id,
      type: PointsEntryType.EARNED,
      status: PointsEntryStatus.CLAIMABLE,
      amountCents: 250,
      orderId: null,
      claimableAt: new Date(Date.now() - 24 * 3600 * 1000),
      expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    }),
  );

  console.log('Seeding comisión claimable demo para promotor…');
  await commRepo.save(
    commRepo.create({
      promoterId: promoter.id,
      referredUserId: client.id,
      orderId: null,
      type: PromoterCommissionEntryType.EARNED,
      status: PromoterCommissionEntryStatus.CLAIMABLE,
      amountCents: 500,
      claimableAt: new Date(Date.now() - 24 * 3600 * 1000),
      payoutId: null,
    }),
  );

  console.log('\nSeed completo. Números de teléfono (OTP log en consola):');
  console.log('  Super admin   → +15555550001');
  console.log('  Promotor      → +15555550005 (código DEMO123A)');
  console.log('  Cliente       → +15555550004 (referido por DEMO123A) — sin-deuda, límite $50');
  console.log('  Cliente AlDía → +15555550006 (María Pérez) — debe $15, due en 15 días');
  console.log('  Cliente Venc. → +15555550007 (Juan Rodríguez) — debe $25, vencido hace 5 días');
  console.log('  Cliente tiene $2.50 claimable en puntos.');
  console.log('  Promotor tiene $5.00 claimable en comisiones.');

  await AppDataSource.destroy();
}

run().catch((err) => {
  console.error('Seed falló:', err);
  process.exit(1);
});
