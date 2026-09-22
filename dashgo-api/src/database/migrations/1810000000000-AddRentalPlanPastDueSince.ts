import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "La suscripción ES el bebedero" — el bebedero gratuito de un suscriptor
 * vive en `rentals` con `monthly_rent_cents = 0`, así que su propia
 * suscripción de Stripe (también $0) nunca falla y nunca reporta mora. Quien
 * SÍ puede atrasarse es el PLAN que lo paga (`subscriptions`, $6.99/mes). Sin
 * esta columna no había forma de distinguir "este alquiler está atrasado
 * porque SU webhook lo dice" de "está atrasado porque el PLAN que lo paga
 * dejó de pagarse" — y el panel de Alquileres nunca se enteraba de lo
 * segundo.
 *
 * `plan_past_due_since` es NULLABLE y escrita una sola vez por
 * PlanDelinquencyListener (igual que `past_due_since`): se pone cuando el
 * plan cae a past_due/unpaid/canceled y vuelve a NULL cuando el plan
 * recupera `active`. Para un alquiler que se paga solo, queda NULL siempre.
 */
export class AddRentalPlanPastDueSince1810000000000
  implements MigrationInterface
{
  name = 'AddRentalPlanPastDueSince1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rentals"
        ADD COLUMN IF NOT EXISTS "plan_past_due_since" TIMESTAMP WITH TIME ZONE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rentals" DROP COLUMN IF EXISTS "plan_past_due_since";
    `);
  }
}
