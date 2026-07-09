import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushToken } from '../../entities/push-token.entity';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts up to 100 messages per request. */
const EXPO_BATCH_SIZE = 100;

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
    const devices = await this.tokens.find({ where: { userId } });
    if (devices.length === 0) return 0;

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.token,
      title,
      body,
      data,
      sound: 'default',
    }));

    let accepted = 0;
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
        const { data: tickets } = (await res.json()) as {
          data: ExpoPushTicket[];
        };
        for (let j = 0; j < tickets.length; j++) {
          const ticket = tickets[j];
          if (ticket.status === 'ok') {
            accepted += 1;
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
    return accepted;
  }
}
