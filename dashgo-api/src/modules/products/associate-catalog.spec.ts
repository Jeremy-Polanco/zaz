import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../../entities/enums';
import { isAssociate } from '../../common/roles';
import {
  assertAssociateCart,
  canCarryAssociatePrice,
} from './associate-catalog';

describe('canCarryAssociatePrice', () => {
  const base = {
    pricingMode: 'single_payment' as const,
    isMaintenanceService: false,
    isDefaultSubscriberBebedero: false,
    isPremiumSubscriberProduct: false,
  };

  it('is true for a plain single-payment product', () => {
    expect(canCarryAssociatePrice(base)).toBe(true);
  });

  it('is false for a rental', () => {
    expect(canCarryAssociatePrice({ ...base, pricingMode: 'rental' })).toBe(
      false,
    );
  });

  it.each([
    'isMaintenanceService',
    'isDefaultSubscriberBebedero',
    'isPremiumSubscriberProduct',
  ] as const)('is false when %s is set', (flag) => {
    expect(canCarryAssociatePrice({ ...base, [flag]: true })).toBe(false);
  });
});

describe('assertAssociateCart', () => {
  it('accepts a cart where every product has an associate price', () => {
    expect(() =>
      assertAssociateCart([{ associatePriceCents: 500 }]),
    ).not.toThrow();
  });

  it('rejects a cart with a product that has no associate price', () => {
    let error: unknown;
    try {
      assertAssociateCart([
        { associatePriceCents: 500 },
        { associatePriceCents: null },
      ]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: 'PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES',
      message: 'Este producto no está disponible para asociados',
    });
  });
});

describe('isAssociate', () => {
  it('is true only for the associate role', () => {
    expect(isAssociate(UserRole.ASSOCIATE)).toBe(true);
    expect(isAssociate(UserRole.CLIENT)).toBe(false);
    expect(isAssociate(null)).toBe(false);
    expect(isAssociate(undefined)).toBe(false);
  });
});
