import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PoolService } from './pool.service';

/**
 * Reparto trimestral del pool de asociados.
 *
 * Corre todos los días a las 00:10 de Nueva York y reparte lo que esté vencido:
 * el 1 de enero/abril/julio/octubre reparte el trimestre que acaba de cerrar, y
 * cualquier otro día es un no-op barato. Que sea diario (y no solo el día de
 * corte) más el corrido de arranque son la red de seguridad: si la app estuvo
 * caída el día del corte, el siguiente tick o el siguiente boot recupera los
 * trimestres atrasados. Es seguro correrlo muchas veces y en varias instancias:
 * el reparto reclama cada trimestre con un insert único.
 */
const BOOT_DELAY_MS = 20_000;

@Injectable()
export class PoolCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PoolCron.name);
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly pool: PoolService) {}

  onApplicationBootstrap(): void {
    // Los specs de integración levantan AppModule sobre una base compartida y
    // pueden durar más de 20 s: el corrido de arranque repartiría, a mitad de
    // un test, los trimestres sembrados por OTROS specs. En test no corre
    // (createTestingApp y el globalSetup fijan NODE_ENV=test); el cron diario y
    // `distributeDueQuarters` se prueban llamándolos directo.
    if (process.env.NODE_ENV === 'test') return;

    // Fuera del camino de boot: que la app termine de levantar primero.
    this.bootTimer = setTimeout(() => void this.run('boot'), BOOT_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  @Cron('10 0 * * *', { timeZone: 'America/New_York' })
  async runDaily(): Promise<void> {
    await this.run('daily');
  }

  /** Los errores se loguean y no se propagan: un cron no puede tirar la app. */
  async run(trigger: 'boot' | 'daily'): Promise<void> {
    try {
      const done = await this.pool.distributeDueQuarters();
      this.logger.log(
        `reparto del pool (${trigger}): ${done.length ? done.join(', ') : 'nada vencido'}`,
      );
    } catch (err) {
      this.logger.error(
        `reparto del pool (${trigger}) falló: ${(err as Error).message}`,
      );
    }
  }
}
