import { UserRole } from '../../entities/enums';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  role: UserRole;
}
