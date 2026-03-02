/**
 * Mock subscription data — user starts on Free plan
 */

import type { SubscriptionStatus, SubscriptionFeature } from '../../api/types';

const FEATURES: SubscriptionFeature[] = [
  { name: 'Barbell Curl tracking', freeIncluded: true, premiumIncluded: true },
  { name: 'Push-up tracking', freeIncluded: true, premiumIncluded: true },
  { name: 'Basic form scoring', freeIncluded: true, premiumIncluded: true },
  { name: 'Workout history', freeIncluded: true, premiumIncluded: true },
  { name: 'All exercises', freeIncluded: false, premiumIncluded: true },
  { name: 'Voice coaching (TTS)', freeIncluded: false, premiumIncluded: true },
  { name: 'Advanced analytics', freeIncluded: false, premiumIncluded: true },
  { name: 'AI Trainer insights', freeIncluded: false, premiumIncluded: true },
  { name: 'Priority support', freeIncluded: false, premiumIncluded: true },
];

export const mockSubscriptionStatus: SubscriptionStatus = {
  plan: 'premium',
  planLabel: 'Pro',
  features: FEATURES,
};
