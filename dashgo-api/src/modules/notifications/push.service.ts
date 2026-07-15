import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushToken } from '../../entities/push-token.entity';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo accepts up to 100 messages per send request. */
const EXPO_BATCH_SIZE = 100;
/** Expo accepts up to 300 ids per receipt request. */
const EXPO_RECEIPT_BATCH_SIZE = 300;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound: 'default';
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** An accepted ticket plus the device token it was sent to (for pruning). */
export interface PushTicketRef {
  id: string;
  token: string;
}

export interface PushSendResult {
  accepted: number;
  tickets: PushTicketRef[];
}

/**
 * Outcome of a receipt check. A ticket is `pending` until Expo publishes its
 * receipt — APNs/FCM rejections (bad credentials, dead device) land here as
 * `failed`, which is the ONLY place they are visible: an accepted ticket
 * says nothing about delivery.
 */
export interface PushReceiptSummary {
  delivered: number;
  failed: number;
  pending: number;
  /** Distinct Expo/APNs/FCM error codes seen (e.g. DeviceNotRegistered). */
  errors: string[];
}

/**
 * Sends push notifications through the Expo Push API. No SDK — plain fetch,
 * same style as WhatsAppService. Expo handles APNs/FCM server-side, so no
 * Apple/Google credentials live here.
 *
 * Best-effort by design: callers fire-and-forget; failures are logged, never
 * thrown. Tokens Expo reports as DeviceNotRegistered (uninstalled app,
 * revoked permission) are deleted so they don't accumulate.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
  ) {}

  async register(
    userId: string,
    token: string,
    platform: 'ios' | 'android',
  ): Promise<void> {
    // Upsert on the token: a re-login on the same device moves the token to
    // the new user instead of failing the unique index.
    await this.tokens
      .createQueryBuilder()
      .insert()
      .values({ userId, token, platform })
      .orUpdate(['user_id', 'platform', 'updated_at'], ['token'])
      .execute();
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.tokens.delete({ userId, token });
  }

  /**
   * Send `title`/`body` to every registered device of `userId`. Resolves to
   * the number of messages Expo accepted; never rejects.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<number> {
    const { accepted } = await this.sendToUserTracked(userId, title, body, data);
    return accepted;
  }

  /**
   * Same as `sendToUser` but also returns the accepted ticket ids so the
   * caller can later ask Expo for delivery receipts via `checkReceipts`.
   */
  async sendToUserTracked(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushSendResult> {
    const devices = await this.tokens.find({ where: { userId } });
    if (devices.length === 0) return { accepted: 0, tickets: [] };

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.token,
      title,
      body,
      data,
      sound: 'default',
    }));

    let accepted = 0;
    const tickets: PushTicketRef[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        });
        if (!res.ok) {
          this.logger.error(
            `Expo push HTTP ${res.status} for user ${userId}: ${(await res.text()).slice(0, 300)}`,
          );
          continue;
        }
        const { data: ticketData } = (await res.json()) as {
          data: ExpoPushTicket[];
        };
        for (let j = 0; j < ticketData.length; j++) {
          const ticket = ticketData[j];
          if (ticket.status === 'ok') {
            accepted += 1;
            if (ticket.id) tickets.push({ id: ticket.id, token: batch[j].to });
            continue;
          }
          const badToken = batch[j].to;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            await this.tokens.delete({ token: badToken });
            this.logger.log(`pruned dead push token …${badToken.slice(-8)}`);
          } else {
            this.logger.warn(
              `push ticket error for user ${userId}: ${ticket.message ?? ticket.details?.error}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Expo push network error for user ${userId}: ${(err as Error).message}`,
        );
      }
    }
    return { accepted, tickets };
  }

  /**
   * Ask Expo for the delivery receipts of previously accepted tickets. This
   * is where APNs/FCM-level failures surface (an accepted ticket only means
   * Expo queued the message). Receipts not yet published count as `pending`.
   * Never rejects; on network failure the unqueried tickets stay `pending`.
   */
  async checkReceipts(tickets: PushTicketRef[]): Promise<PushReceiptSummary> {
    const summary: PushReceiptSummary = {
      delivered: 0,
      failed: 0,
      pending: 0,
      errors: [],
    };
    const errorCodes = new Set<string>();

    for (let i = 0; i < tickets.length; i += EXPO_RECEIPT_BATCH_SIZE) {
      const batch = tickets.slice(i, i + EXPO_RECEIPT_BATCH_SIZE);
      try {
        const res = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch.map((t) => t.id) }),
        });
        if (!res.ok) {
          this.logger.error(
            `Expo receipts HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
          );
          summary.pending += batch.length;
          continue;
        }
        const { data: receipts } = (await res.json()) as {
          data: Record<string, ExpoPushReceipt>;
        };
        for (const ticket of batch) {
          const receipt = receipts[ticket.id];
          if (!receipt) {
            summary.pending += 1;
            continue;
          }
          if (receipt.status === 'ok') {
            summary.delivered += 1;
            continue;
          }
          summary.failed += 1;
          const code = receipt.details?.error ?? receipt.message ?? 'unknown';
          errorCodes.add(code);
          if (receipt.details?.error === 'DeviceNotRegistered') {
            await this.tokens.delete({ token: ticket.token });
            this.logger.log(
              `pruned dead push token …${ticket.token.slice(-8)} (receipt)`,
            );
          } else {
            this.logger.warn(
              `push receipt error for token …${ticket.token.slice(-8)}: ${code}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Expo receipts network error: ${(err as Error).message}`,
        );
        summary.pending += batch.length;
      }
    }
    summary.errors = [...errorCodes];
    return summary;
  }
}
