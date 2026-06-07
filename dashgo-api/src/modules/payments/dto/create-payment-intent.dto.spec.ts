import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePaymentIntentDto,
  PaymentIntentAddressInput,
  PaymentIntentItemInput,
} from './create-payment-intent.dto';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('CreatePaymentIntentDto', () => {
  describe('PaymentIntentItemInput', () => {
    it('passes validation with a valid uuid and positive integer quantity', async () => {
      const item = plainToInstance(PaymentIntentItemInput, {
        productId: VALID_UUID,
        quantity: 3,
      });

      expect(item).toBeInstanceOf(PaymentIntentItemInput);
      expect(item.productId).toBe(VALID_UUID);
      expect(item.quantity).toBe(3);

      const errors = await validate(item);
      expect(errors).toHaveLength(0);
    });

    it('fails validation when productId is not a uuid', async () => {
      const item = plainToInstance(PaymentIntentItemInput, {
        productId: 'not-a-uuid',
        quantity: 1,
      });

      const errors = await validate(item);
      const productErr = errors.find((e) => e.property === 'productId');
      expect(productErr).toBeDefined();
      expect(productErr?.constraints).toHaveProperty('isUuid');
    });

    it('fails validation when quantity is not a positive integer', async () => {
      const item = plainToInstance(PaymentIntentItemInput, {
        productId: VALID_UUID,
        quantity: -2,
      });

      const errors = await validate(item);
      const qtyErr = errors.find((e) => e.property === 'quantity');
      expect(qtyErr).toBeDefined();
      expect(qtyErr?.constraints).toHaveProperty('isPositive');
    });

    it('fails validation when quantity is a non-integer number', async () => {
      const item = plainToInstance(PaymentIntentItemInput, {
        productId: VALID_UUID,
        quantity: 1.5,
      });

      const errors = await validate(item);
      const qtyErr = errors.find((e) => e.property === 'quantity');
      expect(qtyErr).toBeDefined();
      expect(qtyErr?.constraints).toHaveProperty('isInt');
    });
  });

  describe('PaymentIntentAddressInput', () => {
    it('passes validation with only the required text field (optional lat/lng omitted)', async () => {
      const address = plainToInstance(PaymentIntentAddressInput, {
        text: 'Calle 1, Santo Domingo',
      });

      expect(address).toBeInstanceOf(PaymentIntentAddressInput);
      expect(address.text).toBe('Calle 1, Santo Domingo');
      expect(address.lat).toBeUndefined();
      expect(address.lng).toBeUndefined();

      const errors = await validate(address);
      expect(errors).toHaveLength(0);
    });

    it('passes validation with text plus numeric lat/lng', async () => {
      const address = plainToInstance(PaymentIntentAddressInput, {
        text: 'Calle 1',
        lat: 18.4861,
        lng: -69.9312,
      });

      const errors = await validate(address);
      expect(errors).toHaveLength(0);
      expect(address.lat).toBe(18.4861);
      expect(address.lng).toBe(-69.9312);
    });

    it('fails validation when text is not a string', async () => {
      const address = plainToInstance(PaymentIntentAddressInput, {
        text: 123,
      });

      const errors = await validate(address);
      const textErr = errors.find((e) => e.property === 'text');
      expect(textErr).toBeDefined();
      expect(textErr?.constraints).toHaveProperty('isString');
    });

    it('fails validation when lat is provided but not a number', async () => {
      const address = plainToInstance(PaymentIntentAddressInput, {
        text: 'Calle 1',
        lat: 'no-numero',
      });

      const errors = await validate(address);
      const latErr = errors.find((e) => e.property === 'lat');
      expect(latErr).toBeDefined();
      expect(latErr?.constraints).toHaveProperty('isNumber');
    });

    it('fails validation when lng is provided but not a number', async () => {
      const address = plainToInstance(PaymentIntentAddressInput, {
        text: 'Calle 1',
        lng: 'no-numero',
      });

      const errors = await validate(address);
      const lngErr = errors.find((e) => e.property === 'lng');
      expect(lngErr).toBeDefined();
      expect(lngErr?.constraints).toHaveProperty('isNumber');
    });
  });

  describe('CreatePaymentIntentDto', () => {
    it('transforms nested items into PaymentIntentItemInput instances via @Type factory', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [
          { productId: VALID_UUID, quantity: 2 },
          { productId: VALID_UUID, quantity: 5 },
        ],
      });

      expect(dto).toBeInstanceOf(CreatePaymentIntentDto);
      expect(dto.items).toHaveLength(2);
      expect(dto.items[0]).toBeInstanceOf(PaymentIntentItemInput);
      expect(dto.items[1]).toBeInstanceOf(PaymentIntentItemInput);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('transforms nested deliveryAddress into PaymentIntentAddressInput instance via @Type factory', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [{ productId: VALID_UUID, quantity: 1 }],
        usePoints: true,
        deliveryAddress: { text: 'Calle 1', lat: 18.5, lng: -69.9 },
      });

      expect(dto.deliveryAddress).toBeInstanceOf(PaymentIntentAddressInput);
      expect(dto.usePoints).toBe(true);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes validation when optional usePoints and deliveryAddress are omitted', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [{ productId: VALID_UUID, quantity: 1 }],
      });

      expect(dto.usePoints).toBeUndefined();
      expect(dto.deliveryAddress).toBeUndefined();

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails validation when items is empty (ArrayMinSize)', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [],
      });

      const errors = await validate(dto);
      const itemsErr = errors.find((e) => e.property === 'items');
      expect(itemsErr).toBeDefined();
      expect(itemsErr?.constraints).toHaveProperty('arrayMinSize');
    });

    it('fails validation when items is not an array (IsArray)', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: 'not-an-array',
      });

      const errors = await validate(dto);
      const itemsErr = errors.find((e) => e.property === 'items');
      expect(itemsErr).toBeDefined();
      expect(itemsErr?.constraints).toHaveProperty('isArray');
    });

    it('fails validation with nested item errors via ValidateNested (each: true)', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [{ productId: 'bad', quantity: 0 }],
      });

      const errors = await validate(dto);
      const itemsErr = errors.find((e) => e.property === 'items');
      expect(itemsErr).toBeDefined();
      expect(itemsErr?.children?.length).toBeGreaterThan(0);
    });

    it('fails validation when usePoints is provided but not a boolean', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [{ productId: VALID_UUID, quantity: 1 }],
        usePoints: 'yes',
      });

      const errors = await validate(dto);
      const usePointsErr = errors.find((e) => e.property === 'usePoints');
      expect(usePointsErr).toBeDefined();
      expect(usePointsErr?.constraints).toHaveProperty('isBoolean');
    });

    it('fails validation with nested deliveryAddress errors via ValidateNested', async () => {
      const dto = plainToInstance(CreatePaymentIntentDto, {
        items: [{ productId: VALID_UUID, quantity: 1 }],
        deliveryAddress: { text: 123 },
      });

      const errors = await validate(dto);
      const addrErr = errors.find((e) => e.property === 'deliveryAddress');
      expect(addrErr).toBeDefined();
      expect(addrErr?.children?.length).toBeGreaterThan(0);
    });
  });
});
