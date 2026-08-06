import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from '../../entities';
import { SubscriptionTier } from '../../entities/subscription-plan.entity';
import { OrdersService } from './orders.service';
import { RentalsService } from '../rentals/rentals.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PremiumProductListener } from './premium-product.listener';

describe('PremiumProductListener', () => {
  let listener: PremiumProductListener;
  let products: { findOne: jest.Mock };
  let orders: { create: jest.Mock; deliverProvisionedOrder: jest.Mock };
  let rentals: { findActiveByUserAndProduct: jest.Mock };
  let subscriptions: {
    getActiveTier: jest.Mock;
    listActiveSubscriberUserIds: jest.Mock;
  };

  beforeEach(async () => {
    products = {
      findOne: jest.fn().mockResolvedValue({ id: 'prod-premium' }),
    };
    orders = {
      create: jest.fn().mockResolvedValue({ id: 'order-1' }),
      deliverProvisionedOrder: jest.fn().mockResolvedValue(true),
    };
    rentals = { findActiveByUserAndProduct: jest.fn().mockResolvedValue(null) };
    subscriptions = {
      getActiveTier: jest.fn().mockResolvedValue(SubscriptionTier.PREMIUM),
      listActiveSubscriberUserIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PremiumProductListener,
        { provide: getRepositoryToken(Product), useValue: products },
        { provide: OrdersService, useValue: orders },
        { provide: RentalsService, useValue: rentals },
        { provide: SubscriptionService, useValue: subscriptions },
      ],
    }).compile();

    listener = module.get(PremiumProductListener);
  });

  describe('solo corre para premium', () => {
    it('provisiona cuando el evento dice premium', async () => {
      await listener.handleSubscriptionActivated({
        userId: 'u-1',
        tier: SubscriptionTier.PREMIUM,
      });
      expect(orders.create).toHaveBeenCalled();
    });

    it('NO provisiona para un suscriptor standard', async () => {
      await listener.handleSubscriptionActivated({
        userId: 'u-1',
        tier: SubscriptionTier.STANDARD,
      });
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('sin tier en el evento lo consulta, y no asume premium', async () => {
      subscriptions.getActiveTier.mockResolvedValueOnce(
        SubscriptionTier.STANDARD,
      );
      await listener.handleSubscriptionActivated({ userId: 'u-1' });
      expect(subscriptions.getActiveTier).toHaveBeenCalledWith('u-1');
      expect(orders.create).not.toHaveBeenCalled();
    });
  });

  describe('la instalación se entrega', () => {
    it('lleva la orden a entregada — es lo que activa el alquiler', async () => {
      await listener.provisionForUser('u-1');
      expect(orders.deliverProvisionedOrder).toHaveBeenCalledWith('order-1');
    });

    it('si la entrega no sale, igual reporta creada y el reconcile reintenta', async () => {
      orders.deliverProvisionedOrder.mockResolvedValueOnce(false);
      await expect(listener.provisionForUser('u-1')).resolves.toBe('created');
    });
  });

  describe('idempotencia y fallas', () => {
    it('no crea nada si el usuario ya tiene el alquiler', async () => {
      rentals.findActiveByUserAndProduct.mockResolvedValueOnce({ id: 'r-1' });
      await expect(listener.provisionForUser('u-1')).resolves.toBe('skipped');
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('sin producto premium configurado no explota', async () => {
      products.findOne.mockResolvedValueOnce(null);
      await expect(listener.provisionForUser('u-1')).resolves.toBe('no-product');
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('un conflicto de negocio se difiere, no tira', async () => {
      orders.create.mockRejectedValueOnce(
        new ConflictException({ code: 'ACTIVE_ORDER_EXISTS' }),
      );
      await expect(listener.provisionForUser('u-1')).resolves.toBe('skipped');
    });

    it('un error inesperado tampoco tira — no puede tumbar la activación', async () => {
      orders.create.mockRejectedValueOnce(new Error('boom'));
      await expect(listener.provisionForUser('u-1')).resolves.toBe('skipped');
    });
  });

  describe('reconcile horario', () => {
    it('solo toca a los suscriptores premium', async () => {
      subscriptions.listActiveSubscriberUserIds.mockResolvedValueOnce([
        'prem-1',
        'std-1',
      ]);
      subscriptions.getActiveTier
        .mockResolvedValueOnce(SubscriptionTier.PREMIUM)
        .mockResolvedValueOnce(SubscriptionTier.STANDARD);

      await listener.reconcileHourly();

      expect(orders.create).toHaveBeenCalledTimes(1);
    });
  });
});
