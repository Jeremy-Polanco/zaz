import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea el producto "Bebedero Premium" — el alquilado exclusivo del plan
 * premium — si ningún producto lleva todavía esa marca.
 *
 * Es una migración de DATOS a propósito: el deploy corre las migraciones solo
 * (deploy_on_push), así que esto deja el producto existiendo en producción sin
 * pasos manuales. Idempotente contra el índice único parcial: si el admin ya
 * creó (o después edita/renombra) su propio producto premium, esta migración
 * no toca nada.
 *
 * Decisiones de los campos:
 *  - requires_quote = false → la orden de instalación automática se
 *    auto-confirma y puede entregarse sola (deliverProvisionedOrder exige
 *    llegar a confirmada; con cotización manual quedaría esperando un humano).
 *  - stock = 99999 → el centinela "sin tracking" del panel; la instalación no
 *    puede fallar por "sin stock".
 *  - monthly_rent_cents = 3499 → FALLBACK de catálogo (premium $29.99 + $5).
 *    El precio vivo lo resuelve resolvePremiumBebederoRentCents contra el plan
 *    premium real; este número solo se cobra si no hay plan configurado.
 *  - sin imagen (pedido así); se puede subir después desde el panel.
 */
export class SeedPremiumBebederoProduct1806000000000
  implements MigrationInterface
{
  name = 'SeedPremiumBebederoProduct1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "products" (
        "name", "description", "price_to_public", "is_available", "stock",
        "requires_quote", "pricing_mode", "monthly_rent_cents",
        "requires_maintenance", "is_premium_subscriber_product", "tax_category"
      )
      SELECT
        'Bebedero Premium',
        'Bebedero exclusivo del plan Premium. 1 incluido con tu suscripción; adicionales al precio de la suscripción.',
        '34.99', true, 99999,
        false, 'rental', 3499,
        true, true, 'standard'
      WHERE NOT EXISTS (
        SELECT 1 FROM "products" WHERE "is_premium_subscriber_product" = true
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Solo se borra si nadie lo alquiló nunca: borrar un producto con rentals
    // colgando destruiría historial de facturación.
    await queryRunner.query(`
      DELETE FROM "products" p
        WHERE p."is_premium_subscriber_product" = true
        AND p."name" = 'Bebedero Premium'
        AND NOT EXISTS (SELECT 1 FROM "rentals" r WHERE r."product_id" = p."id");
    `);
  }
}
