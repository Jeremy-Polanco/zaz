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
  /** Código postal de 5 dígitos que escribió el cliente; null en las viejas. */
  postalCode!: string | null;
  /** Zona de reparto RESUELTA a partir del ZIP; null si no matchea ninguna. */
  zoneId!: string | null;
  /**
   * Tasa de impuesto que le toca a esta dirección, como fracción (0.06625 =
   * 6.625%). NO es columna: se calcula al responder, a partir de la zona.
   * Una dirección sin zona devuelve el fallback histórico (TAX_RATE), nunca 0.
   */
  taxRate!: number;
  isDefault!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
