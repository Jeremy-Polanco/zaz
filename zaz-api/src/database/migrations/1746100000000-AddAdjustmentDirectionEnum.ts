import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `adjustment_increase` and `adjustment_decrease` to the
 * `credit_movement_type` Postgres enum so the `manualAdjustment` service
 * method can record the direction of each adjustment.
 *
 * NOTE: Postgres does not support removing enum values, so the legacy
 * `adjustment` value is kept for backward-compatibility with existing rows.
 * New writes use the specific directional values.
 *
 * DOWN: no-op — Postgres can't remove enum values without recreating the type.
 */
export class AddAdjustmentDirectionEnum1746100000000 implements MigrationInterface {
  name = 'AddAdjustmentDirectionEnum1746100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE credit_movement_type ADD VALUE IF NOT EXISTS 'adjustment_increase'`,
    );
    await queryRunner.query(
      `ALTER TYPE credit_movement_type ADD VALUE IF NOT EXISTS 'adjustment_decrease'`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot remove enum values without recreating the entire type
    // and migrating all dependent columns. This down migration is intentionally
    // left as a no-op. If a rollback is needed, manually recreate the type or
    // restore from a backup.
  }
}
