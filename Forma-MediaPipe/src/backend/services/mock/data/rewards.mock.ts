/**
 * Mock rewards data extracted from RewardsScreen
 */

import { UserStats, Reward } from '../../api/types';

export const mockUserStats: UserStats = {
  formScore: 87,
  consistencyScore: 79,
};

export const mockRewards: Reward[] = [
  {
    id: '1',
    title: 'Free Protein Shake',
    description: 'Redeem at any partner gym',
    pointsRequired: 200,
    iconName: 'Pill',
    color: '#20d760', // COLORS.primary
    category: 'Supplements',
  },
  {
    id: '2',
    title: 'Healthy Meal Voucher',
    description: '$15 off at partner restaurants',
    pointsRequired: 350,
    iconName: 'Utensils',
    color: '#F59E0B',
    category: 'Meals',
  },
  {
    id: '3',
    title: 'Gym Day Pass',
    description: 'Free day pass at partner gyms',
    pointsRequired: 500,
    iconName: 'Dumbbell',
    color: '#20d760', // COLORS.primary
    category: 'Gym',
  },
  {
    id: '4',
    title: 'Resistance Bands Set',
    description: 'Premium exercise bands',
    pointsRequired: 750,
    iconName: 'ShoppingBag',
    color: '#8B5CF6',
    category: 'Accessories',
  },
  {
    id: '5',
    title: 'Monthly Supplement Box',
    description: 'Curated supplements for your goals',
    pointsRequired: 1000,
    iconName: 'Pill',
    color: '#EC4899',
    category: 'Supplements',
  },
  {
    id: '6',
    title: 'Weekly Meal Prep',
    description: '7 healthy meals delivered',
    pointsRequired: 1500,
    iconName: 'Utensils',
    color: '#F59E0B',
    category: 'Meals',
  },
  {
    id: '7',
    title: 'Monthly Gym Membership',
    description: 'Full access to partner gyms',
    pointsRequired: 2500,
    iconName: 'Dumbbell',
    color: '#20d760', // COLORS.primary
    category: 'Gym',
  },
  {
    id: '8',
    title: 'Premium Gym Bag',
    description: 'High-quality training bag',
    pointsRequired: 3000,
    iconName: 'ShoppingBag',
    color: '#8B5CF6',
    category: 'Accessories',
  },
];
