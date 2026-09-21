import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserAddress } from '../../entities/user-address.entity';
import { User } from '../../entities/user.entity';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { resolveZoneId } from './resolve-zone';
import { TaxJurisdictionService } from './tax-jurisdiction.service';
import type { TaxRateQuery } from './tax-jurisdiction.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import type { GeocodedPlace } from '../geocoding/nominatim';
import type { TaxJurisdictionCode } from '../../entities/tax-jurisdiction.entity';

/**
 * La dirección como la ve el cliente: la fila más la TASA de impuesto que le
 * corresponde y la LEY que la fijó.
 *
 * Ninguna de las dos es columna a propósito. Salen de `tax_jurisdictions` (y,
 * si alguien lo cargó, del override de la zona), y eso se edita: copiadas en
 * cada dirección habría que rebackfillear la libreta entera cada vez que un
 * estado cambia un decimal. Se calculan al responder, que es cuando importan.
 *
 * `taxJurisdiction` viaja al lado de `taxRate` para que la app pueda decir
 * "6.625% (New Jersey)" y no sólo un número suelto.
 */
export type AddressResponse = UserAddress & {
  taxRate: number;
  taxJurisdiction: TaxJurisdictionCode | null;
};

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(DeliveryZone)
    private readonly zones: Repository<DeliveryZone>,
    private readonly dataSource: DataSource,
    private readonly taxJurisdictionService: TaxJurisdictionService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * List addresses for a user ordered by default first, then by created_at ASC.
   */
  async list(userId: string): Promise<AddressResponse[]> {
    const addresses = await this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    return this.withTaxRates(addresses);
  }

  /**
   * Create a new address. Enforces 10-address cap.
   * First-ever address for a user is automatically set as default.
   * Throws 400 ADDRESS_CAP_EXCEEDED if the user already has 10 addresses.
   */
  async create(userId: string, dto: CreateAddressDto): Promise<AddressResponse> {
    const count = await this.addresses.count({ where: { userId } });
    if (count >= 10) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ADDRESS_CAP_EXCEEDED',
        message: 'Solo puedes guardar hasta 10 direcciones',
      });
    }
    const isFirst = count === 0;

    // La chincheta se convierte en jurisdicción ACÁ, en el servidor. El cliente
    // manda un punto en el mapa; la ciudad, el estado y el condado los deriva
    // el servidor porque el estado decide la tasa de impuesto: un dato que
    // manda el cliente es un dato que el cliente elige.
    //
    // Nunca bloquea: si Nominatim no contesta, `place` es null y la dirección
    // se guarda igual, sólo que sin los campos derivados.
    const place = await this.geocoding.reverse(dto.lat, dto.lng);

    // El ZIP y el número de puerta que ESCRIBIÓ el cliente mandan sobre los
    // geocodificados: el cliente sabe por qué código postal le entra el correo,
    // y en el borde de dos polígonos el geocoder puede devolver el de al lado.
    const postalCode = normalizeZip(dto.postalCode) ?? place?.postalCode ?? null;
    const entity = this.addresses.create({
      ...dto,
      userId,
      isDefault: isFirst,
      postalCode,
      houseNumber: normalizeText(dto.houseNumber) ?? place?.houseNumber ?? null,
      // Estos tres se escriben SIEMPRE desde el geocoder — nunca desde el DTO,
      // aunque el cliente los mande (el ValidationPipe ya los rechaza, esto es
      // el cinturón además de los tirantes).
      ...geocodedFacts(place),
      // El sello de "acá ya miró el geocoder". Se pone cuando CONTESTÓ, aunque
      // no se haya podido mapear el estado (un punto de Pennsylvania contesta
      // pero no está en el mapa de siglas): si no, el backfill —que busca
      // `state IS NULL`— volvería a pedir esa misma fila en cada vuelta.
      geocodedAt: place ? new Date() : null,
      // La zona se guarda RESUELTA, no se calcula al vuelo: agrupar clientes
      // por zona es una pantalla que pagina y recalcular prefijos por fila la
      // haría inútil.
      zoneId: await this.resolveZone(postalCode),
    });
    return this.withTaxRate(await this.addresses.save(entity));
  }

  /**
   * Update a user's address. Only whitelisted fields are applied.
   * isDefault is deliberately never set here — use setDefault() for that.
   * Throws 404 if the address doesn't exist or belongs to another user.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<AddressResponse> {
    const addr = await this.addresses.findOne({ where: { id } });
    if (!addr || addr.userId !== userId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'ADDRESS_NOT_FOUND',
        message: 'Dirección no encontrada',
      });
    }
    // Defensive: apply only whitelisted fields — never copy isDefault through
    const previousZip = addr.postalCode;
    const pinMoved =
      (dto.lat !== undefined && dto.lat !== addr.lat) ||
      (dto.lng !== undefined && dto.lng !== addr.lng);

    if (dto.label !== undefined) addr.label = dto.label;
    if (dto.line1 !== undefined) addr.line1 = dto.line1;
    if (dto.line2 !== undefined) addr.line2 = dto.line2 ?? null;
    if (dto.building !== undefined) addr.building = dto.building ?? null;
    if (dto.lat !== undefined) addr.lat = dto.lat;
    if (dto.lng !== undefined) addr.lng = dto.lng;
    if (dto.instructions !== undefined) addr.instructions = dto.instructions ?? null;
    if (dto.houseNumber !== undefined) {
      addr.houseNumber = normalizeText(dto.houseNumber);
    }
    if (dto.postalCode !== undefined) addr.postalCode = normalizeZip(dto.postalCode);

    // Se vuelve a geocodificar en DOS casos, y en ninguno más:
    //  - la chincheta se movió: el estado guardado es el del punto viejo;
    //  - la fila todavía no tiene estado (dirección anterior a la migración
    //    1809): editarla es la oportunidad de completarla sin esperar al
    //    backfill.
    // Guardar el formulario sin mover nada NO gasta una llamada: la política de
    // Nominatim es 1 request/segundo y cada llamada de más acerca el bloqueo.
    if (pinMoved || addr.state === null) {
      const place = await this.geocoding.reverse(addr.lat, addr.lng);
      if (place) {
        Object.assign(addr, geocodedFacts(place));
        addr.geocodedAt = new Date();
        // Si la chincheta se movió, el ZIP y el número de puerta guardados son
        // los del punto VIEJO: mudarse de Elizabeth al Bronx sin que el ZIP
        // siga al punto dejaría la dirección cobrando New Jersey. Si no se
        // movió, sólo se rellena lo que está vacío — no se pisa lo que el
        // cliente escribió alguna vez.
        if (dto.postalCode === undefined && (pinMoved || !addr.postalCode)) {
          addr.postalCode = place.postalCode ?? addr.postalCode;
        }
        if (dto.houseNumber === undefined && (pinMoved || !addr.houseNumber)) {
          addr.houseNumber = place.houseNumber ?? addr.houseNumber;
        }
      } else if (pinMoved) {
        // El geocoder no contestó Y la chincheta se movió: lo que está guardado
        // describe el punto VIEJO. Dejarlo puesto es peor que borrarlo —
        // quedaría una dirección del Bronx cobrando New Jersey, y para siempre:
        // como la fila TIENE estado, ni el próximo `update()` ni el backfill
        // (`state IS NULL`) la vuelven a mirar.
        //
        // Se borra también el ZIP geocodificado y la zona que salía de él, SALVO
        // que el cliente haya escrito un ZIP en este mismo request: eso no es un
        // dato viejo, lo acaba de tipear.
        addr.city = null;
        addr.state = null;
        addr.county = null;
        if (dto.postalCode === undefined) {
          addr.postalCode = null;
          addr.zoneId = null;
        }
        // `geocodedAt` queda como estaba en null (o se vuelve a null si la fila
        // venía sellada): un fallo del geocoder NO es un "ya lo miramos", y esta
        // fila tiene que volver a intentarse — en el próximo update y en el
        // backfill.
        addr.geocodedAt = null;
      }
    }

    // La zona sólo se re-resuelve cuando el ZIP TERMINÓ distinto del que había:
    // guardar el formulario entero sin tocar el código postal es el caso normal
    // y no tiene por qué pegarle a la tabla de zonas.
    if (addr.postalCode !== previousZip) {
      addr.zoneId = await this.resolveZone(addr.postalCode);
    }
    return this.withTaxRate(await this.addresses.save(addr));
  }

  /**
   * Delete an address. If it was the default and other addresses remain,
   * promotes the most-recently-created remaining address to default.
   * Runs inside a transaction. Throws 404 if not found or wrong user.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(UserAddress);
      const target = await repo.findOne({ where: { id } });
      if (!target || target.userId !== userId) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'ADDRESS_NOT_FOUND',
          message: 'Dirección no encontrada',
        });
      }
      const wasDefault = target.isDefault;
      await repo.delete(id);
      if (wasDefault) {
        const next = await repo.findOne({
          where: { userId },
          order: { createdAt: 'DESC' },
        });
        if (next) {
          next.isDefault = true;
          await repo.save(next);
        }
      }
    });
  }

  /**
   * Promote an address to default. Inside a transaction:
   *   1) Clears is_default on all other addresses for this user.
   *   2) Sets is_default=true on the target.
   * Throws 404 if the address doesn't exist or belongs to another user.
   */
  async setDefault(userId: string, id: string): Promise<AddressResponse> {
    const updated = await this.dataSource.transaction(async (mgr) => {
      const repo = mgr.getRepository(UserAddress);
      const target = await repo.findOne({ where: { id } });
      if (!target || target.userId !== userId) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'ADDRESS_NOT_FOUND',
          message: 'Dirección no encontrada',
        });
      }
      await repo
        .createQueryBuilder()
        .update(UserAddress)
        .set({ isDefault: false })
        .where('user_id = :userId AND is_default = true', { userId })
        .execute();
      target.isDefault = true;
      return repo.save(target);
    });
    return this.withTaxRate(updated);
  }

  /**
   * Set the user's active operating location (the address they currently
   * dispatch from). Primary use: a repartidor with multiple locations picks
   * which one is active — it becomes the shipping origin. Validates ownership
   * of the address, then points users.active_location_id at it.
   * Throws 404 if the address doesn't exist or belongs to another user.
   * Returns the now-active address.
   */
  async setActiveLocation(userId: string, id: string): Promise<AddressResponse> {
    const target = await this.addresses.findOne({ where: { id } });
    if (!target || target.userId !== userId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'ADDRESS_NOT_FOUND',
        message: 'Dirección no encontrada',
      });
    }
    await this.users.update(userId, { activeLocationId: id });
    return this.withTaxRate(target);
  }

  /**
   * Super-admin variant: list any user's addresses.
   * No ownership check — the controller's RolesGuard handles authorization.
   */
  async listByUserId(targetUserId: string): Promise<AddressResponse[]> {
    return this.list(targetUserId);
  }

  /**
   * Los dos datos viajan, pero el que manda es el ZIP (ver
   * `delivery-zones.service.ts`): `zone_id` se resolvió el día que se guardó la
   * dirección y nadie lo refresca si el admin le cambia los prefijos a una
   * zona. Va igual como respaldo — sin ZIP, o con un ZIP que no cae en ningún
   * prefijo, es el único dato que queda.
   */
  private static taxRateQuery(address: UserAddress): TaxRateQuery {
    return {
      zoneId: address.zoneId ?? null,
      postalCode: address.postalCode,
      // Lo que derivó el servidor. El estado es el dato que decide la ley; el
      // ZIP queda como respaldo para las filas que todavía no se geocodificaron.
      state: address.state,
      city: address.city,
      county: address.county,
    };
  }

  private async withTaxRate(address: UserAddress): Promise<AddressResponse> {
    const { taxRate, jurisdiction } =
      await this.taxJurisdictionService.resolveTaxRate(
        AddressesService.taxRateQuery(address),
      );
    return { ...address, taxRate, taxJurisdiction: jurisdiction };
  }

  /** En lote: diez direcciones no pueden ser diez consultas a la tabla. */
  private async withTaxRates(
    addresses: UserAddress[],
  ): Promise<AddressResponse[]> {
    const rates = await this.taxJurisdictionService.resolveTaxRates(
      addresses.map((a) => AddressesService.taxRateQuery(a)),
    );
    return addresses.map((address, i) => ({
      ...address,
      taxRate: rates[i].taxRate,
      taxJurisdiction: rates[i].jurisdiction,
    }));
  }

  /**
   * Zona de reparto que le corresponde a un código postal. Se traen TODAS las
   * zonas activas y se resuelve en memoria: son un puñado de filas y el
   * "prefijo más largo que matchea" no se puede pedir en SQL sin un LIKE por
   * fila. Sin ZIP no hay consulta — no habría nada que resolver.
   */
  private async resolveZone(postalCode: string | null): Promise<string | null> {
    if (!postalCode) return null;
    const zones = await this.zones.find({ where: { isActive: true } });
    return resolveZoneId(postalCode, zones);
  }
}

/**
 * El ZIP llega ya validado como 5 dígitos por el DTO; acá sólo se normaliza el
 * borde: ausente, vacío o null son todos "sin código postal" (null), para que
 * el UPDATE no escriba un string vacío que después no matchea ningún prefijo.
 */
function normalizeZip(value: string | null | undefined): string | null {
  const zip = (value ?? '').trim();
  return zip || null;
}

/** Mismo borde para cualquier texto opcional: vacío es "no lo mandó". */
function normalizeText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text || null;
}

/**
 * Los tres campos que SON del servidor. Se devuelven juntos para que no haya
 * forma de escribir uno y olvidarse de otro — y para que quede en un solo lugar
 * la regla de que estos NUNCA salen del DTO.
 *
 * Sin geocodificación quedan en null: una dirección sin estado resuelve la tasa
 * por el ZIP y, si tampoco hay ZIP, cae en el fallback histórico. Nunca 0.
 */
function geocodedFacts(place: GeocodedPlace | null): {
  city: string | null;
  state: string | null;
  county: string | null;
} {
  return {
    city: place?.city ?? null,
    state: place?.state ?? null,
    county: place?.county ?? null,
  };
}
