import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CommissionEntry,
  CommissionEntryStatus,
  CommissionEntryType,
  EarnerRole,
  SellerProduct,
  User,
} from '../../entities';
import { PaymentMethod, UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SellersService } from './sellers.service';

const admin = {
  id: 'admin-1',
  role: UserRole.SUPER_ADMIN_DELIVERY,
  email: null,
} as AuthenticatedUser;

const seller = {
  id: 'seller-1',
  role: UserRole.SELLER,
  email: null,
} as AuthenticatedUser;

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);

function entry(o: Partial<CommissionEntry>): CommissionEntry {
  return {
    id: 'e-1',
    earnerId: 'seller-1',
    earnerRole: EarnerRole.SELLER,
    type: CommissionEntryType.EARNED,
    status: CommissionEntryStatus.PENDING,
    amountCents: 100,
    paymentMethod: PaymentMethod.DIGITAL,
    claimableAt: PAST,
    ...o,
  } as CommissionEntry;
}

describe('SellersService', () => {
  let service: SellersService;
  let commissions: { find: jest.Mock };
  let users: { find: jest.Mock };

  beforeEach(async () => {
    commissions = { find: jest.fn().mockResolvedValue([]) };
    users = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellersService,
        { provide: getRepositoryToken(CommissionEntry), useValue: commissions },
        { provide: getRepositoryToken(SellerProduct), useValue: {} },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(SellersService);
  });

  describe('getEarnings — permisos', () => {
    it('un vendedor NO puede ver los ingresos de otro', async () => {
      await expect(service.getEarnings('otro', seller)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('un vendedor SÍ puede ver los suyos', async () => {
      await expect(
        service.getEarnings('seller-1', seller),
      ).resolves.toMatchObject({ sellerId: 'seller-1' });
    });

    it('un cliente no puede ver ingresos de nadie', async () => {
      await expect(
        service.getEarnings('seller-1', {
          id: 'seller-1',
          role: UserRole.CLIENT,
          email: null,
        } as AuthenticatedUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('el super admin puede ver los de cualquiera', async () => {
      await expect(
        service.getEarnings('seller-1', admin),
      ).resolves.toMatchObject({ sellerId: 'seller-1' });
    });
  });

  describe('getEarnings — buckets', () => {
    it('un asiento vencido cuenta como COBRABLE aunque el cron no haya corrido', async () => {
      commissions.find.mockResolvedValueOnce([
        entry({ amountCents: 500, claimableAt: PAST }),
      ]);
      const r = await service.getEarnings('seller-1', admin);
      expect(r.claimableCents).toBe(500);
      expect(r.pendingCents).toBe(0);
    });

    it('un asiento todavía en vesting cuenta como PENDIENTE', async () => {
      commissions.find.mockResolvedValueOnce([
        entry({ amountCents: 500, claimableAt: FUTURE }),
      ]);
      const r = await service.getEarnings('seller-1', admin);
      expect(r.pendingCents).toBe(500);
      expect(r.claimableCents).toBe(0);
    });

    it('un asiento pagado cuenta como PAGADO aunque esté vencido', async () => {
      commissions.find.mockResolvedValueOnce([
        entry({
          amountCents: 500,
          status: CommissionEntryStatus.PAID,
          claimableAt: PAST,
        }),
      ]);
      const r = await service.getEarnings('seller-1', admin);
      expect(r.paidCents).toBe(500);
      expect(r.claimableCents).toBe(0);
    });

    it('ignora los asientos de tipo paid_out (son el contra-asiento, no un devengo)', async () => {
      commissions.find.mockResolvedValueOnce([
        entry({ amountCents: 500, type: CommissionEntryType.PAID_OUT }),
      ]);
      const r = await service.getEarnings('seller-1', admin);
      expect(r.claimableCents).toBe(0);
      expect(r.pendingCents).toBe(0);
      expect(r.paidCents).toBe(0);
    });
  });

  describe('getEarnings — desglose tarjeta vs efectivo', () => {
    it('separa por método de pago sin alterar el total', async () => {
      // Este desglose ES el dato: con tarjeta la plata entró a la empresa y se
      // le debe la comisión; en efectivo alguien ya agarró los billetes.
      commissions.find.mockResolvedValueOnce([
        entry({ id: 'a', amountCents: 300, paymentMethod: PaymentMethod.DIGITAL }),
        entry({ id: 'b', amountCents: 700, paymentMethod: PaymentMethod.CASH }),
      ]);

      const r = await service.getEarnings('seller-1', admin);

      expect(r.claimableCents).toBe(1000);
      expect(r.byPaymentMethod.card.claimableCents).toBe(300);
      expect(r.byPaymentMethod.cash.claimableCents).toBe(700);
    });

    it('los asientos históricos sin método caen en "unknown", no en efectivo', async () => {
      // Adivinar el método sería peor que admitir que no se sabe: un asiento
      // viejo contado como tarjeta se pagaría dos veces.
      commissions.find.mockResolvedValueOnce([
        entry({ amountCents: 400, paymentMethod: null }),
      ]);

      const r = await service.getEarnings('seller-1', admin);

      expect(r.byPaymentMethod.unknown.claimableCents).toBe(400);
      expect(r.byPaymentMethod.cash.claimableCents).toBe(0);
      expect(r.byPaymentMethod.card.claimableCents).toBe(0);
    });

    it('consulta SOLO los asientos de vendedor, no los de promotor', async () => {
      await service.getEarnings('seller-1', admin);
      expect(commissions.find).toHaveBeenCalledWith({
        where: { earnerId: 'seller-1', earnerRole: EarnerRole.SELLER },
      });
    });
  });

  describe('getPayableSummary', () => {
    it('lo rechaza a quien no es super admin', async () => {
      await expect(service.getPayableSummary(seller)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('devuelve una fila por vendedor con su nombre', async () => {
      users.find.mockResolvedValueOnce([
        { id: 'seller-1', fullName: 'Juan' },
        { id: 'seller-2', fullName: 'Ana' },
      ]);
      const r = await service.getPayableSummary(admin);
      expect(r.map((x) => x.fullName)).toEqual(['Juan', 'Ana']);
    });
  });
});
