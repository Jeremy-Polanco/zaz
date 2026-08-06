import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suscripciones por tier: `standard` (la de siempre) y `premium`.
 *
 * Hasta ahora el sistema asumía UN solo plan — `subscription_plan` se consultaba
 * con `findOne({ where: {} })`, literalmente "dame la única fila". Este cambio
 * levanta ese supuesto SIN alterar nada de lo existente: el plan actual queda en
 * 'standard' y todas las suscripciones vivas también, así que ningún
 * suscriptor cambia de beneficios.
 *
 * `subscriptions.tier` es un SNAPSHOT. Se resuelve al sincronizar con Stripe
 * usando el `stripe_product_id` del plan y no el price id: cuando el admin
 * cambia el precio, Stripe emite un price NUEVO (los precios son inmutables) y
 * el viejo queda vivo para quien ya estaba suscripto. El producto, en cambio,
 * no rota — es el único ancla estable para saber en qué plan está alguien.
 */
export class AddSubscriptionTiers1804000000000 implements MigrationInterface {
  name = 'AddSubscriptionTiers1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_plan"
        ADD COLUMN IF NOT EXISTS "tier" character varying(20) NOT NULL DEFAULT 'standard';
    `);
    await queryRunner.query(`
      ALTER TABLE "subscription_plan"
        ADD CONSTRAINT "CHK_subscription_plan_tier"
        CHECK ("tier" IN ('standard', 'premium'));
    `);
    // Un solo plan por tier. Sin esto, dos filas 'premium' harían que
    // "¿cuál es el plan premium?" no tenga respuesta determinística.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscription_plan_tier"
        ON "subscription_plan" ("tier");
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD COLUMN IF NOT EXISTS "tier" character varying(20) NOT NULL DEFAULT 'standard';
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "CHK_subscriptions_tier"
        CHECK ("tier" IN ('standard', 'premium'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "CHK_subscriptions_tier";
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "tier";
    `);
    // El esquema viejo solo admite un plan. Si quedó uno premium, borrarlo:
    // dejarlo haría que `findOne({where:{}})` devuelva a veces el premium y a
    // veces el standard según el orden físico de las filas — o sea, precios
    // cobrados al azar.
    await queryRunner.query(`
      DELETE FROM "subscription_plan" WHERE "tier" = 'premium';
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_subscription_plan_tier";`);
    await queryRunner.query(`
      ALTER TABLE "subscription_plan" DROP CONSTRAINT IF EXISTS "CHK_subscription_plan_tier";
    `);
    await queryRunner.query(`
      ALTER TABLE "subscription_plan" DROP COLUMN IF EXISTS "tier";
    `);
  }
}
