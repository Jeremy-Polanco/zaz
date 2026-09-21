// Explicit response shape — used in tests for assertion fidelity.
// Service returns UserAddress entity directly; entity field shape matches 1:1.
export class AddressResponseDto {
  id!: string;
  userId!: string;
  label!: string;
  line1!: string;
  line2!: string | null;
  lat!: number;
  lng!: number;
  instructions!: string | null;
  /** Código postal de 5 dígitos: el que escribió el cliente, o el geocodificado. */
  postalCode!: string | null;
  /** Número de puerta: el que escribió el cliente, o el geocodificado. */
  houseNumber!: string | null;
  /**
   * Ciudad / estado (2 letras) / condado. DERIVADOS POR EL SERVIDOR desde la
   * lat/lng: el cliente no los manda ni los puede pisar (ver CreateAddressDto).
   * null mientras la dirección no se haya podido geocodificar.
   */
  city!: string | null;
  state!: string | null;
  county!: string | null;
  /** Zona de reparto RESUELTA a partir del ZIP; null si no matchea ninguna. */
  zoneId!: string | null;
  /**
   * Tasa de impuesto que le toca a esta dirección, como fracción (0.06625 =
   * 6.625%). NO es columna: se calcula al responder, a partir de la
   * jurisdicción del destino (y del override de zona, si alguien lo cargó).
   * Una dirección sin jurisdicción devuelve el fallback histórico (TAX_RATE),
   * nunca 0.
   */
  taxRate!: number;
  /**
   * QUÉ LEY fijó esa tasa: 'NJ', 'NYC' o null (ninguna, se usó el fallback).
   * Va al lado del número para que la app pueda decir "6.625% (New Jersey)".
   */
  taxJurisdiction!: 'NJ' | 'NYC' | null;
  isDefault!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
