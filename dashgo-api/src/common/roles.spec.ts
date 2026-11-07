import { UserRole } from '../entities/enums';
import { buysAsClient } from './roles';

describe('buysAsClient', () => {
  it('es true para el cliente y para el asociado', () => {
    expect(buysAsClient(UserRole.CLIENT)).toBe(true);
    expect(buysAsClient(UserRole.ASSOCIATE)).toBe(true);
  });

  it('es false para promotor, vendedor y super admin', () => {
    expect(buysAsClient(UserRole.PROMOTER)).toBe(false);
    expect(buysAsClient(UserRole.SELLER)).toBe(false);
    expect(buysAsClient(UserRole.SUPER_ADMIN_DELIVERY)).toBe(false);
  });
});
