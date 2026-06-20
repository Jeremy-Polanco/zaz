import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * FIX HIGH-G6 — Durable audit trail for account deletions (GDPR defensibility).
 *
 * `logger.warn` in AuthService.deleteAccount is ephemeral. For Article 17
 * "right to erasure" requests we need a durable, queryable trail that the
 * deletion actually happened, WITHOUT keeping the PII itself.
 *
 * The phone and email are stored as sha256 hashes salted with JWT_SECRET so
 * an auditor can verify "was this number deleted?" by re-hashing, but the
 * raw values cannot be recovered. The Stripe customer id is kept for ops
 * reconciliation only — it is not PII on its own.
 *
 * No FK to users — the users row is gone by the time anyone queries this.
 */
@Entity('account_deletions')
export class AccountDeletion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'hashed_phone', type: 'text' })
  hashedPhone!: string;

  @Column({ name: 'hashed_email', type: 'text', nullable: true })
  hashedEmail!: string | null;

  @Column({ name: 'stripe_customer_id', type: 'text', nullable: true })
  stripeCustomerId!: string | null;

  @Column({ name: 'requested_via', type: 'text', nullable: true })
  requestedVia!: string | null;

  /**
   * When an admin deleted the account (requested_via = 'admin'), the id of the
   * super admin who performed the deletion. NULL for self-service ('in-app')
   * deletions. No FK — both the actor and the target user rows may be gone by
   * the time this is audited.
   */
  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
