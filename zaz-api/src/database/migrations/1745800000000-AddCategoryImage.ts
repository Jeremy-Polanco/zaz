import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryImage1745800000000 implements MigrationInterface {
  name = 'AddCategoryImage1745800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categories
        ADD COLUMN image_bytes bytea NULL,
        ADD COLUMN image_content_type varchar(100) NULL,
        ADD COLUMN image_updated_at timestamptz NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categories
        DROP COLUMN image_updated_at,
        DROP COLUMN image_content_type,
        DROP COLUMN image_bytes
    `);
  }
}
