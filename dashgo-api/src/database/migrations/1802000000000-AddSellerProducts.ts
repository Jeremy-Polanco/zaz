import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogo por vendedor: qué productos lleva y cuánto gana por cada uno.
 *
 * Tabla vacía al crearse, y eso es a propósito: mientras un vendedor no tenga
 * filas, sus clientes siguen viendo el catálogo completo. Un vendedor nuevo no
 * puede dejar a su cartera sin poder comprar.
 *
 * `commission_pct` es lo que GANA el vendedor (mismo sentido que
 * `products.promoter_commission_pct`, no invertido).
 */
export class AddSellerProducts1802000000000 implements MigrationInterface {
  name = 'AddSellerProducts1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seller_products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "seller_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "commission_pct" numeric(5,2) NOT NULL DEFAULT '0',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seller_products" PRIMARY KEY ("id")
      );
    `);
    // Un producto aparece UNA sola vez por vendedor. Sin esto, dos filas del
    // mismo par darían dos comisiones por la misma línea.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_seller_products_seller_product"
        ON "seller_products" ("seller_id", "product_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_products_seller_id"
        ON "seller_products" ("seller_id");
    `);
    await queryRunner.query(`
      ALTER TABLE "seller_products"
        ADD CONSTRAINT "FK_seller_products_seller"
        FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE;
    `);
    await queryRunner.query(`
      ALTER TABLE "seller_products"
        ADD CONSTRAINT "FK_seller_products_product"
        FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
    `);
    await queryRunner.query(`
      ALTER TABLE "seller_products"
        ADD CONSTRAINT "CHK_seller_products_commission_pct"
        CHECK ("commission_pct" >= 0 AND "commission_pct" <= 100);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_products";`);
  }
}
