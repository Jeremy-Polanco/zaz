import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `subscriptions.user_id` era UNIQUE (constraint
 * "UQ_d0a95ef8a28188364c546eb65c1" desde InitialSchema) — pero un usuario
 * legítimamente acumula MÁS de una fila: cada vez que cancela y vuelve a
 * suscribirse, Stripe emite un `stripe_subscription_id` nuevo y
 * `upsertSubscription` hace `INSERT ... ON CONFLICT (stripe_subscription_id)`
 * (nunca por `user_id`), así que la fila vieja `canceled` se queda quieta y la
 * nueva intenta INSERTarse aparte.
 *
 * Con la unique constraint puesta, ese INSERT tira duplicate key en
 * "user_id", `upsertSubscription` lo swallowea (try/catch de
 * `reconcileWithStripe` / el handler del webhook), la fila `canceled` vieja
 * sobrevive como única fila del usuario y `PlanDelinquencyListener.syncForUser`
 * termina marcando UNPAID el bebedero de $0 de un cliente que SÍ está pagando.
 *
 * El resto del código ya asumía "varias filas, la más nueva por
 * current_period_end gana" (getMySubscription, cancelAtPeriodEnd, reactivate,
 * el LEFT JOIN correlacionado de UsersService.findAll) — la unique constraint
 * era la única pieza que no lo asumía. Se reemplaza por un índice no-único
 * (sigue sirviendo para el filtro por user_id de esas mismas queries).
 */
export class DropSubscriptionsUserIdUnique1811000000000
  implements MigrationInterface
{
  name = 'DropSubscriptionsUserIdUnique1811000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP CONSTRAINT IF EXISTS "UQ_d0a95ef8a28188364c546eb65c1";
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscriptions_user_id"
        ON "subscriptions" ("user_id");
    `);
  }

  /**
   * OJO: este `down` falla si para entonces ya existen usuarios con más de
   * una fila en `subscriptions` (exactamente el escenario que esta migración
   * habilita) — Postgres no puede crear una UNIQUE constraint sobre una
   * columna con duplicados. Es un rollback esperable-para-que-falle una vez
   * que el sistema empezó a depender de la multiplicidad; no lo forzar en
   * producción sin antes purgar filas viejas a mano.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_subscriptions_user_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "UQ_d0a95ef8a28188364c546eb65c1" UNIQUE ("user_id");
    `);
  }
}
