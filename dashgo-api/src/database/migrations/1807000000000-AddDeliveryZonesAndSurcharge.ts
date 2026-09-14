import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Zonas de reparto + recargo por distancia + día de entrega asignado.
 *
 * Resuelve dos pedidos del dueño con un solo concepto (la zona):
 *   1. "Quiero saber de dónde son los clientes — los del Bronx en un lado, los
 *      de Brooklyn en otro, los de Manhattan en otro, Elizabeth en otro."
 *   2. "Hay clientes que están muy lejos: que me deje ponerles el día que les
 *      toca el delivery y cobrarles un delivery aparte del envío."
 *
 * Hasta acá NINGUNA dirección guardaba ciudad ni código postal — sólo texto
 * libre y lat/lng — así que la pregunta (1) era literalmente incontestable.
 *
 * La migración es financieramente NEUTRA: las zonas se siembran con
 * `surcharge_cents = 0` y `delivery_surcharge` arranca en 0 para todas las
 * órdenes existentes. Ningún total cambia hasta que el admin cargue montos.
 */
export class AddDeliveryZonesAndSurcharge1807000000000 implements MigrationInterface {
  name = 'AddDeliveryZonesAndSurcharge1807000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_zones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(80) NOT NULL,
        "zip_prefixes" character varying[] NOT NULL DEFAULT '{}',
        "surcharge_cents" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_zones" PRIMARY KEY ("id")
      );
    `);
    // El recargo es plata: no puede ser negativo por un typo en el panel.
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        DROP CONSTRAINT IF EXISTS "CHK_delivery_zones_surcharge_nonneg";
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        ADD CONSTRAINT "CHK_delivery_zones_surcharge_nonneg"
        CHECK ("surcharge_cents" >= 0);
    `);

    // --- Dirección: de dónde es el cliente -----------------------------------
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        ADD COLUMN IF NOT EXISTS "postal_code" character varying(12),
        ADD COLUMN IF NOT EXISTS "city" character varying(120),
        ADD COLUMN IF NOT EXISTS "zone_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        DROP CONSTRAINT IF EXISTS "FK_user_addresses_zone_id";
    `);
    // SET NULL y no CASCADE: borrar una zona jamás puede borrar la dirección
    // del cliente.
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        ADD CONSTRAINT "FK_user_addresses_zone_id"
        FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id")
        ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_addresses_zone_id"
        ON "user_addresses" ("zone_id");
    `);

    // --- Orden: recargo y día asignado ---------------------------------------
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "delivery_surcharge" numeric(10,2) NOT NULL DEFAULT '0';
    `);
    // La factura necesita su PROPIO recargo: es un documento fiscal congelado,
    // no una vista de la orden. Sin esta columna sus renglones no suman el
    // total (subtotal − puntos + envío + impuesto + propina ≠ total) en cuanto
    // el pedido lleva recargo por distancia.
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "delivery_surcharge" numeric(10,2) NOT NULL DEFAULT '0';
    `);
    // `date` y no `timestamptz`: es un DÍA de reparto, no un instante. Con hora
    // la zona horaria correría el día en el borde de la medianoche.
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "scheduled_delivery_date" date;
    `);
    // El reparto del día se consulta por fecha: "¿qué entrego el martes?".
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_orders_scheduled_delivery_date"
        ON "orders" ("scheduled_delivery_date");
    `);

    // --- Semilla: las cuatro zonas que nombró el dueño -----------------------
    // Recargo en 0 — el esquema entra sin mover un centavo. Los prefijos son
    // los ZIP reales: Bronx 104xx, Brooklyn 112xx, Manhattan 100xx-102xx,
    // Elizabeth NJ 0720x (07201/02/06/08). La resolución elige el prefijo más
    // largo que matchea, así una zona fina le gana a una gruesa.
    await queryRunner.query(`
      INSERT INTO "delivery_zones" ("name", "zip_prefixes", "surcharge_cents")
      SELECT * FROM (VALUES
        ('Bronx',         ARRAY['104']::character varying[],               0),
        ('Brooklyn',      ARRAY['112']::character varying[],               0),
        ('Manhattan',     ARRAY['100','101','102']::character varying[],   0),
        ('Elizabeth NJ',  ARRAY['0720']::character varying[],              0)
      ) AS seed(name, zip_prefixes, surcharge_cents)
      WHERE NOT EXISTS (SELECT 1 FROM "delivery_zones");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP COLUMN IF EXISTS "delivery_surcharge";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_orders_scheduled_delivery_date";
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "scheduled_delivery_date",
        DROP COLUMN IF EXISTS "delivery_surcharge";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_user_addresses_zone_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        DROP CONSTRAINT IF EXISTS "FK_user_addresses_zone_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        DROP COLUMN IF EXISTS "zone_id",
        DROP COLUMN IF EXISTS "city",
        DROP COLUMN IF EXISTS "postal_code";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_zones";`);
  }
}
