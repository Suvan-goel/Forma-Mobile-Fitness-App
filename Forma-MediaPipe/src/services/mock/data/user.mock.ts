/**
 * Mock user data
 */

import { User } from '../../api/types';

export const mockUser: User = {
  id: 'user-1',
  email: 'user@forma.app',
  displayName: 'Fitness User',
  avatarUrl: undefined,
  createdAt: new Date(2024, 0, 1),
};
