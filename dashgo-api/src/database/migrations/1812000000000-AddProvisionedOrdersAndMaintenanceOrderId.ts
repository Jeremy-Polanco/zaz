import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mantenimiento automático del bebedero — el sistema genera la orden de la
 * visita en vez de esperar a que el cliente toque "Solicitar mantenimiento"
 * (nadie lo tocaba y el mantenimiento nunca se hacía).
 *
 * Dos columnas, cada una por una razón distinta:
 *
 * 1. `orders.provisioned` — marca las órdenes que crea EL SISTEMA (el bebedero
 *    gratis, la instalación premium y ahora el mantenimiento) y que ningún
 *    cliente pidió por checkout. Hasta hoy eso sólo vivía en un flag de runtime
 *    (`opts.provisioned`) que ponía el envío en $0 y se perdía al commitear.
 *    Persistirlo permite que la guarda "un pedido activo a la vez" las ignore
 *    en AMBOS sentidos: una orden de sistema abierta por días (programada para
 *    una visita) no debe bloquear el agua del cliente, y un pedido de agua del
 *    cliente no debe impedirle al sistema generar su mantenimiento.
 *    DEFAULT false: todo lo anterior a esta migración es una orden normal.
 *
 * 2. `rentals.maintenance_order_id` — la orden de mantenimiento ABIERTA de ese
 *    bebedero. Es lo que vuelve idempotente al cron (el segundo corrido ve que
 *    ya hay una orden y no crea otra) y lo que deja a la app del cliente decir
 *    "Mantenimiento programado para el martes". Se vuelve NULL al entregar la
 *    visita (se reinicia el contador) y por `ON DELETE SET NULL` si el admin
 *    borra la orden cancelada: sin orden el bebedero vuelve a estar "debido".
 */
export class AddProvisionedOrdersAndMaintenanceOrderId1812000000000
  implements MigrationInterface
{
  name = 'AddProvisionedOrdersAndMaintenanceOrderId1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "provisioned" boolean NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      ALTER TABLE "rentals"
        ADD COLUMN IF NOT EXISTS "maintenance_order_id" uuid;
    `);
    // El FK va aparte del ADD COLUMN para que `IF NOT EXISTS` de la columna no
    // deje al FK duplicándose si la migración se re-corre a mano.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_rentals_maintenance_order_id'
        ) THEN
          ALTER TABLE "rentals"
            ADD CONSTRAINT "FK_rentals_maintenance_order_id"
            FOREIGN KEY ("maintenance_order_id") REFERENCES "orders"("id")
            ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rentals"
        DROP CONSTRAINT IF EXISTS "FK_rentals_maintenance_order_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "rentals" DROP COLUMN IF EXISTS "maintenance_order_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "provisioned";
    `);
  }
}
