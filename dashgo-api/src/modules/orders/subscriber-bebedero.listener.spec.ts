import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from '../../entities';
import { PaymentMethod, UserRole } from '../../entities/enums';
import { OrdersService } from './orders.service';
import { RentalsService } from '../rentals/rentals.service';
import { SubscriberBebederoListener } from './subscriber-bebedero.listener';

describe('SubscriberBebederoListener', () => {
  let listener: SubscriberBebederoListener;
  let products: { findOne: jest.Mock };
  let orders: { create: jest.Mock };
  let rentals: { findActiveByUserAndProduct: jest.Mock };

  beforeEach(async () => {
    products = { findOne: jest.fn() };
    orders = { create: jest.fn().mockResolvedValue({ id: 'order-1' }) };
    rentals = { findActiveByUserAndProduct: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriberBebederoListener,
        { provide: getRepositoryToken(Product), useValue: products },
        { provide: OrdersService, useValue: orders },
        { provide: RentalsService, useValue: rentals },
      ],
    }).compile();

    listener = module.get(SubscriberBebederoListener);
  });

  it('creates a $0 bebedero order for the flagged product when none exists yet', async () => {
    products.findOne.mockResolvedValue({ id: 'prod-beb', isDefaultSubscriberBebedero: true });

    await listener.handleSubscriptionActivated({ userId: 'user-9' });

    expect(rentals.findActiveByUserAndProduct).toHaveBeenCalledWith('user-9', 'prod-beb');
    expect(orders.create).toHaveBeenCalledWith(
      { id: 'user-9', role: UserRole.CLIENT, email: null },
      {
        items: [{ productId: 'prod-beb', quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        usePoints: false,
        useCredit: false,
      },
    );
  });

  it('does nothing when no default subscriber bebedero is configured', async () => {
    products.findOne.mockResolvedValue(null);

    await listener.handleSubscriptionActivated({ userId: 'user-9' });

    expect(orders.create).not.toHaveBeenCalled();
  });

  it('skips when the user already has a bebedero rental (idempotent)', async () => {
    products.findOne.mockResolvedValue({ id: 'prod-beb' });
    rentals.findActiveByUserAndProduct.mockResolvedValue({ id: 'rental-x' });

    await listener.handleSubscriptionActivated({ userId: 'user-9' });

    expect(orders.create).not.toHaveBeenCalled();
  });

  it('swallows RENTAL_ALREADY_ACTIVE conflict (race) without throwing', async () => {
    products.findOne.mockResolvedValue({ id: 'prod-beb' });
    orders.create.mockRejectedValue(
      new ConflictException({ code: 'RENTAL_ALREADY_ACTIVE' }),
    );

    await expect(
      listener.handleSubscriptionActivated({ userId: 'user-9' }),
    ).resolves.toBeUndefined();
  });
});
