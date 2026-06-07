import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreditAccountStatus,
  ListAccountsQueryDto,
} from './list-accounts-query.dto';

/**
 * Helper: convert a plain query-string-shaped object into a DTO instance,
 * running class-transformer's @Type transforms (so `@Type(() => Number)`
 * factory functions are actually invoked).
 */
function toDto(plain: Record<string, unknown>): ListAccountsQueryDto {
  return plainToInstance(ListAccountsQueryDto, plain, {
    enableImplicitConversion: false,
  });
}

describe('ListAccountsQueryDto', () => {
  describe('CreditAccountStatus enum', () => {
    it('exposes the expected status values', () => {
      expect(CreditAccountStatus.AL_DIA).toBe('al-dia');
      expect(CreditAccountStatus.VENCIDO).toBe('vencido');
      expect(CreditAccountStatus.SIN_DEUDA).toBe('sin-deuda');
    });

    it('contains exactly three statuses', () => {
      expect(Object.values(CreditAccountStatus)).toEqual([
        'al-dia',
        'vencido',
        'sin-deuda',
      ]);
    });
  });

  describe('@Type(() => Number) transforms', () => {
    it('coerces a numeric string `page` into a number', () => {
      const dto = toDto({ page: '3' });

      expect(typeof dto.page).toBe('number');
      expect(dto.page).toBe(3);
    });

    it('coerces a numeric string `pageSize` into a number', () => {
      const dto = toDto({ pageSize: '25' });

      expect(typeof dto.pageSize).toBe('number');
      expect(dto.pageSize).toBe(25);
    });

    it('coerces both page and pageSize together', () => {
      const dto = toDto({ page: '2', pageSize: '50' });

      expect(dto.page).toBe(2);
      expect(dto.pageSize).toBe(50);
    });

    it('produces NaN for a non-numeric string (Number() fallback path)', () => {
      const dto = toDto({ page: 'not-a-number' });

      // Number('not-a-number') === NaN; the @Type factory still runs.
      expect(typeof dto.page).toBe('number');
      expect(Number.isNaN(dto.page)).toBe(true);
    });

    it('leaves undefined numeric fields as undefined', () => {
      const dto = toDto({});

      expect(dto.page).toBeUndefined();
      expect(dto.pageSize).toBeUndefined();
    });
  });

  describe('validation — success paths', () => {
    it('passes with an empty payload (all fields optional)', async () => {
      const errors = await validate(toDto({}));

      expect(errors).toHaveLength(0);
    });

    it('passes with a valid status, search, page and pageSize', async () => {
      const dto = toDto({
        status: CreditAccountStatus.VENCIDO,
        search: 'María',
        page: '1',
        pageSize: '10',
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.status).toBe('vencido');
      expect(dto.search).toBe('María');
      expect(dto.page).toBe(1);
      expect(dto.pageSize).toBe(10);
    });

    it.each(Object.values(CreditAccountStatus))(
      'accepts the valid status "%s"',
      async (status) => {
        const errors = await validate(toDto({ status }));

        expect(errors).toHaveLength(0);
      },
    );
  });

  describe('validation — error / guard paths', () => {
    it('rejects an unknown status value via @IsEnum', async () => {
      const errors = await validate(toDto({ status: 'bankrupt' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('status');
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('rejects a non-string search via @IsString', async () => {
      const errors = await validate(toDto({ search: 123 }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('search');
      expect(errors[0].constraints).toHaveProperty('isString');
    });

    it('rejects page below the minimum via @Min(1)', async () => {
      const errors = await validate(toDto({ page: '0' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('page');
      expect(errors[0].constraints).toHaveProperty('min');
    });

    it('rejects a non-integer page via @IsInt', async () => {
      const errors = await validate(toDto({ page: '1.5' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('page');
      expect(errors[0].constraints).toHaveProperty('isInt');
    });

    it('rejects a NaN page (non-numeric string) via @IsInt', async () => {
      const errors = await validate(toDto({ page: 'abc' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('page');
      expect(errors[0].constraints).toHaveProperty('isInt');
    });

    it('rejects pageSize below the minimum via @Min(1)', async () => {
      const errors = await validate(toDto({ pageSize: '0' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('pageSize');
      expect(errors[0].constraints).toHaveProperty('min');
    });

    it('rejects a non-integer pageSize via @IsInt', async () => {
      const errors = await validate(toDto({ pageSize: '3.7' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('pageSize');
      expect(errors[0].constraints).toHaveProperty('isInt');
    });

    it('reports multiple field errors at once', async () => {
      const errors = await validate(
        toDto({ status: 'nope', page: '0', pageSize: '-5' }),
      );

      const properties = errors.map((e) => e.property).sort();
      expect(properties).toEqual(['page', 'pageSize', 'status']);
    });
  });
});
