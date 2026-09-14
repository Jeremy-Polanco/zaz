import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../../entities/app-setting.entity';
import { DEFAULT_FLAT_SHIPPING_CENTS } from '../../common/shipping';

export const SETTING_FLAT_SHIPPING_CENTS = 'flat_shipping_cents';

/**
 * La tarifa plana de envío, editable en caliente por el super admin.
 *
 * Pedido del dueño (2026-09-14): "sería bueno que el super admin pueda
 * modificar la tasa general del delivery". Antes era una constante de código,
 * así que subir el envío $1 significaba un deploy.
 *
 * Vive en `app_settings` (la misma tablita key/value del copy de cumpleaños)
 * y NO reusa `AppSettingsService`: ese servicio es de notifications y su
 * módulo no lo exporta a orders. Duplicar 10 líneas de repositorio sale más
 * barato que atar el módulo de envíos al de notificaciones — y el día que la
 * tarifa necesite historial o auditoría, se toca sólo acá.
 *
 * Sin migración a propósito: la tabla ya existe y la FALTA de fila es un
 * estado válido ("el admin nunca la tocó") que resuelve a
 * DEFAULT_FLAT_SHIPPING_CENTS.
 */
@Injectable()
export class ShippingRateService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly settings: Repository<AppSetting>,
  ) {}

  /**
   * Tarifa vigente en centavos. Lectura defensiva: la columna es `text` y la
   * escribe un humano desde el panel, así que todo lo que no sea un entero >= 0
   * (fila ausente, vacío, "abc", "5.50", negativo) cae al default. Un envío en
   * NaN se propagaría al impuesto y al total de la orden — mejor cobrar los $5
   * de siempre que cobrar basura.
   */
  async getFlatShippingCents(): Promise<number> {
    const row = await this.settings.findOne({
      where: { key: SETTING_FLAT_SHIPPING_CENTS },
    });
    if (!row) return DEFAULT_FLAT_SHIPPING_CENTS;

    // `Number('')` y `Number('   ')` dan 0, no NaN: sin el chequeo de vacío una
    // fila en blanco pasaría por "envío gratis".
    const raw = row.value?.trim();
    const parsed = raw ? Number(raw) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 0) {
      return DEFAULT_FLAT_SHIPPING_CENTS;
    }
    return parsed;
  }

  /**
   * Fija la tarifa y devuelve la que quedó guardada, así el controlador
   * responde exactamente lo que persistió (y el panel no tiene que re-pedirla).
   *
   * `save` sobre la PK hace upsert: la primera vez inserta la fila, las
   * siguientes la pisan. El rango lo valida el DTO (0..10000).
   */
  async setFlatShippingCents(cents: number): Promise<number> {
    await this.settings.save(
      this.settings.create({
        key: SETTING_FLAT_SHIPPING_CENTS,
        value: String(cents),
      }),
    );
    return cents;
  }
}
