import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { PushService } from './push.service';
import type { BroadcastAudience } from './dto/broadcast.dto';

/** Same lapse window as WinBackCron — keep the two audiences consistent. */
const LAPSED_DAYS = 8;

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

  async broadcast(
    audience: BroadcastAudience,
    title: string,
    body: string,
  ): Promise<{ users: number; accepted: number }> {
    const userIds = await this.resolveAudience(audience);
    let accepted = 0;
    for (const userId of userIds) {
      accepted += await this.push.sendToUser(userId, title, body);
    }
    this.logger.log(
      `broadcast (${audience}): ${userIds.length} user(s), ${accepted} message(s) accepted — "${title}"`,
    );
    return { users: userIds.length, accepted };
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
