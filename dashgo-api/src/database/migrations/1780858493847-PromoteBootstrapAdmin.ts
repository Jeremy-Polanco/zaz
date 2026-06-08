import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-off data migration: promote the founder/bootstrap-admin account to
 * SUPER_ADMIN_DELIVERY in production.
 *
 * Why this is needed: AUTH_BOOTSTRAP_ADMIN_PHONES only promotes a phone to
 * super-admin at USER-CREATION time (see auth.service.ts verifyOtp — the role
 * is set only when a new user row is inserted). If the founder logged in
 * BEFORE that env var was configured, their existing row stayed 'client' and
 * no later login re-promotes it. This migration reconciles that one account.
 *
 * Phone matching is digit-normalized: the backend stores whatever the client
 * sends (auth.service trims but does not reformat), and the web stores E.164
 * "+1<10 digits>" while older/other clients may have stored the bare national
 * number. Stripping every non-digit and comparing the trailing national number
 * (with or without the NANP "1") matches the row regardless of stored format —
 * a full 10-digit national number is unique, so there is no collision risk.
 *
 * Safe + idempotent: the role guard makes re-running a no-op, and on a fresh DB
 * (founder not yet logged in) it simply affects 0 rows.
 */
export class PromoteBootstrapAdmin1780858493847 implements MigrationInterface {
    name = 'PromoteBootstrapAdmin1780858493847'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "users"
               SET "role" = 'super_admin_delivery'
             WHERE regexp_replace("phone", '[^0-9]', '', 'g') IN ('8293880711', '18293880711')
               AND "role" <> 'super_admin_delivery'`,
        );
    }

    public async down(): Promise<void> {
        // No-op: a role promotion is intentionally not auto-reverted. Reverting
        // would risk locking the founder out of production on an accidental
        // migration:revert. Demote manually if ever required.
    }
}
