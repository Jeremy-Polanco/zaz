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
  isDefault!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
