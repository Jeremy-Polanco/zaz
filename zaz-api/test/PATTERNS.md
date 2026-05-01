# Test Patterns — zaz-api

## Layout

```
src/
  modules/<feature>/<feature>.service.spec.ts    ← unit tests (mocked deps, in-process)
  test-utils/                                     ← shared helpers
test/
  integration/<feature>.integration-spec.ts     ← real Postgres, mocked Stripe
  e2e/<feature>.e2e-spec.ts                     ← supertest, full app
  docker-compose.test.yml                        ← Postgres 16 on port 5433
  setup-integration.ts                            ← jest globalSetup (run migrations)
  teardown-integration.ts                         ← jest globalTeardown
  jest-e2e.json                                   ← e2e jest config
```

## Running tests

| Command | What runs |
|---------|-----------|
| `npm test` | unit project (in-process, fast) |
| `npm run test:integration` | integration project (requires Docker) |
| `npm run test:e2e` | E2E suite via supertest |
| `npm run test:cov` | unit + coverage report (80% on money modules) |
| `npm run test:concurrency` | concurrency-tagged tests with `--runInBand` |

## Setup for integration/E2E (one-time)

```bash
# Start test Postgres
docker compose -f test/docker-compose.test.yml up -d

# Generate the InitialSchema migration ONCE against your dev DB
npm run migration:generate -- src/database/migrations/InitialSchema
# Commit the output

# Run integration tests (will run all migrations against the test DB)
npm run test:integration
```

## Unit test pattern

```typescript
import { Test } from '@nestjs/testing';
import { CreditService } from './credit.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreditAccount, CreditMovement } from '../../entities/...';

jest.mock('stripe', () => {
  const mockStripe = jest.fn().mockImplementation(() => createMockStripe());
  (mockStripe as unknown as Record<string, unknown>).default = mockStripe;
  return mockStripe;
});

describe('CreditService', () => {
  let service: CreditService;
  let accountRepo: any;
  let movementRepo: any;

  beforeEach(async () => {
    accountRepo = { findOne: jest.fn(), save: jest.fn(), upsert: jest.fn() };
    movementRepo = { findOne: jest.fn(), save: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CreditService,
        { provide: getRepositoryToken(CreditAccount), useValue: accountRepo },
        { provide: getRepositoryToken(CreditMovement), useValue: movementRepo },
      ],
    }).compile();

    service = module.get(CreditService);
  });

  describe('reverseCharge', () => {
    it('is idempotent — returns null if reversal already exists', async () => {
      movementRepo.findOne.mockResolvedValueOnce({ id: 'existing-reversal' });
      const result = await service.reverseCharge('order-123');
      expect(result).toBeNull();
      expect(movementRepo.save).not.toHaveBeenCalled();
    });
  });
});
```

## Integration test pattern (real DB, transaction-rollback per test)

```typescript
import { setupTransactionPerTest } from '../../src/test-utils/transaction';
import { createTestingApp } from '../../src/test-utils/testing-app';

describe('CreditService — integration', () => {
  const ctx = setupTransactionPerTest(); // beforeAll/beforeEach/afterEach hooks

  it('two concurrent charges respect lock @concurrency', async () => {
    const account = await ctx.creditService.grantCredit(userId, 10000, adminId);
    const [r1, r2] = await Promise.all([
      ctx.creditService.applyCharge(userId, 5000, orderA, ctx.manager),
      ctx.creditService.applyCharge(userId, 8000, orderB, ctx.manager),
    ]);
    // Final balance must be mathematically consistent
    const final = await ctx.creditService.getMyAccount(userId);
    expect(final.balanceCents).toBe(account.balanceCents - 5000 - 8000);
  });
});
```

## Stripe mock factory

`src/test-utils/stripe.ts` exposes `createMockStripe()`. Customize per test:

```typescript
import { createMockStripe } from '../../test-utils/stripe';

let mockStripe = createMockStripe();
mockStripe.customers.search.mockResolvedValueOnce({ data: [{ id: 'cus_existing' }] });
```

For webhook signature verification, use `mockStripe.webhooks.constructEvent.mockReturnValueOnce({...event...})`.

## Concurrency tests

Tag with `@concurrency` in describe/it title. Run with `npm run test:concurrency` (uses `--runInBand`).

## Troubleshooting

- **"InitialSchema migration is missing"**: Run `npm run migration:generate -- src/database/migrations/InitialSchema` against your dev DB and commit.
- **"Cannot connect to localhost:5433"**: Run `docker compose -f test/docker-compose.test.yml up -d`.
- **"Stripe not configured"**: Tests should never hit real Stripe. If they do, your jest.mock isn't applied — verify the mock is declared at module top level (above imports of code that uses Stripe).
- **Worker process failed to exit**: Known ts-jest internals issue. Add `--forceExit` to test command if it bothers CI.
