/**
 * Mock rewards data extracted from RewardsScreen
 */

import { UserStats, Reward } from '../../api/types';

export const mockUserStats: UserStats = {
  formScore: 147,        // ~8 workouts of solid form (realistic earned total)
  consistencyScore: 50,  // ~2-3 weeks of hitting weekly target
  earnedBadgeIds: ['1'], // 197 total pts exceeds First Step threshold (1 pt)
};

export const mockRewards: Reward[] = [
  {
    id: '1',
    title: 'First Step',
    description: 'Complete your first scored Forma workout',
    pointsRequired: 1,
    iconName: 'Zap',
    color: '#CD7F32',
    category: 'Bronze',
  },
  {
    id: '2',
    title: 'Form Seeker',
    description: 'The pursuit of perfect form begins',
    pointsRequired: 300,
    iconName: 'Target',
    color: '#CD7F32',
    category: 'Bronze',
  },
  {
    id: '3',
    title: 'Consistent',
    description: 'Building an unbreakable habit',
    pointsRequired: 600,
    iconName: 'Activity',
    color: '#9CA3AF',
    category: 'Silver',
  },
  {
    id: '4',
    title: 'Iron Will',
    description: 'Discipline defines you',
    pointsRequired: 1000,
    iconName: 'Shield',
    color: '#9CA3AF',
    category: 'Silver',
  },
  {
    id: '5',
    title: 'Form Craftsman',
    description: 'Mastering the art of movement',
    pointsRequired: 1500,
    iconName: 'Star',
    color: '#F59E0B',
    category: 'Gold',
  },
  {
    id: '6',
    title: 'Streak Warrior',
    description: 'Consistency is your superpower',
    pointsRequired: 2250,
    iconName: 'Flame',
    color: '#F59E0B',
    category: 'Gold',
  },
  {
    id: '7',
    title: 'Elite',
    description: 'Top tier performer',
    pointsRequired: 3500,
    iconName: 'Trophy',
    color: '#8B5CF6',
    category: 'Elite',
  },
  {
    id: '8',
    title: 'Forma Legend',
    description: 'The pinnacle of form mastery',
    pointsRequired: 5500,
    iconName: 'Crown',
    color: '#EC4899',
    category: 'Legend',
  },
];
