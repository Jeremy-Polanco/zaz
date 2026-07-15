import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { PushService, type PushTicketRef } from './push.service';
import type { BroadcastAudience } from './dto/broadcast.dto';

/** Same lapse window as WinBackCron — keep the two audiences consistent. */
const LAPSED_DAYS = 8;

export interface BroadcastResult {
  users: number;
  /** Tickets Expo accepted — says nothing about delivery. */
  accepted: number;
  /** Receipt verdicts, polled once after RECEIPT_DELAY_MS. */
  delivered: number;
  failed: number;
  pending: number;
  errors: string[];
}

/**
 * Admin broadcast over push. Audience is resolved against the push_tokens
 * registry (only users who can actually receive count), segmented by order
 * recency. WhatsApp is deliberately NOT part of manual broadcasts: free-form
 * text can't be sent through Meta templates, and a mistyped blast against a
 * marketing template is a WABA quality-rating risk. Push is the blast channel.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
    private readonly push: PushService,
  ) {}

  /** Distinct reachable users + device count for the audience — the UI preview. */
  async preview(
    audience: BroadcastAudience,
  ): Promise<{ users: number; devices: number }> {
    const userIds = await this.resolveAudience(audience);
    if (userIds.length === 0) return { users: 0, devices: 0 };
    const devices = await this.tokens
      .createQueryBuilder('pt')
      .where('pt.user_id IN (:...ids)', { ids: userIds })
      .getCount();
    return { users: userIds.length, devices };
  }

  /**
   * How long to wait before asking Expo for receipts. An accepted ticket is
   * only "queued" — APNs/FCM rejections surface in the receipt a few seconds
   * later. One poll after this delay catches the common failures
   * (InvalidCredentials, DeviceNotRegistered) while keeping the admin
   * request tolerably slow. Overridden to 0 in tests.
   */
  protected receiptDelayMs = 10_000;

  async broadcast(
    audience: BroadcastAudience,
    title: string,
    body: string,
  ): Promise<BroadcastResult> {
    const userIds = await this.resolveAudience(audience);
    let accepted = 0;
    const tickets: PushTicketRef[] = [];
    for (const userId of userIds) {
      const result = await this.push.sendToUserTracked(userId, title, body);
      accepted += result.accepted;
      tickets.push(...result.tickets);
    }

    // Poll receipts once so the panel reports delivery truthfully instead of
    // Expo's accept count. Tickets Expo hasn't settled yet stay `pending`.
    let receipts = { delivered: 0, failed: 0, pending: 0, errors: [] as string[] };
    if (tickets.length > 0) {
      await new Promise((r) => setTimeout(r, this.receiptDelayMs));
      receipts = await this.push.checkReceipts(tickets);
    }

    this.logger.log(
      `broadcast (${audience}): ${userIds.length} user(s), ${accepted} accepted, ` +
        `${receipts.delivered} delivered, ${receipts.failed} failed, ` +
        `${receipts.pending} pending${
          receipts.errors.length ? ` [${receipts.errors.join(', ')}]` : ''
        } — "${title}"`,
    );
    return { users: userIds.length, accepted, ...receipts };
  }

  private async resolveAudience(
    audience: BroadcastAudience,
  ): Promise<string[]> {
    // Base: anyone with a registered device. Segments narrow by order recency;
    // users with zero orders only ever appear in 'all'.
    const rows: Array<{ user_id: string }> = await this.tokens.query(
      audience === 'all'
        ? `SELECT DISTINCT pt.user_id FROM push_tokens pt`
        : audience === 'active'
          ? `
            SELECT DISTINCT pt.user_id
            FROM push_tokens pt
            JOIN orders o ON o.customer_id = pt.user_id AND o.status != 'cancelled'
            GROUP BY pt.user_id
            HAVING MAX(o.created_at) > now() - interval '${LAPSED_DAYS} days'
            `
          : `
            SELECT DISTINCT pt.user_id
            FROM push_tokens pt
            JOIN orders o ON o.customer_id = pt.user_id AND o.status != 'cancelled'
            GROUP BY pt.user_id
            HAVING MAX(o.created_at) <= now() - interval '${LAPSED_DAYS} days'
            `,
    );
    return rows.map((r) => r.user_id);
  }
}
