/**
 * Mock social data for development
 */

import {
  LeaderboardEntry,
  LeaderboardResult,
  Friend,
  FriendRequest,
  SuggestedFriend,
  UserSearchResult,
  FriendProfileData,
  ComparisonData,
  ActivityEvent,
  ActivityFeedPage,
  FollowRelation,
  ReactionType,
  ReactionCounts,
  EventReactions,
} from '../../api/types';

// ── Leaderboard mock data ─────────────────────────────────────

const mockLeaderboardEntries: LeaderboardEntry[] = [
  { userId: 'u1', rank: 1, displayName: 'Alex Chen', score: 96.2, streakDays: 8, trend: 'up' },
  { userId: 'u2', rank: 2, displayName: 'Jordan Lee', score: 94.8, streakDays: 7, trend: 'stable' },
  { userId: 'u3', rank: 3, displayName: 'Sam Rivera', score: 93.1, streakDays: 6, trend: 'up' },
  { userId: 'u4', rank: 4, displayName: 'Taylor Kim', score: 91.7, streakDays: 6, trend: 'down' },
  { userId: 'u5', rank: 5, displayName: 'Morgan Wu', score: 90.3, streakDays: 5, trend: 'up' },
  { userId: 'current', rank: 6, displayName: 'You', score: 89.4, streakDays: 4, trend: 'up' },
  { userId: 'u6', rank: 7, displayName: 'Casey Park', score: 88.9, streakDays: 3, trend: 'stable' },
  { userId: 'u7', rank: 8, displayName: 'Riley Zhang', score: 87.4, streakDays: 3, trend: 'down' },
  { userId: 'u8', rank: 9, displayName: 'Dakota Patel', score: 86.1, streakDays: 2, trend: 'up' },
  { userId: 'u9', rank: 10, displayName: 'Avery Singh', score: 85.0, streakDays: 2, trend: 'stable' },
  { userId: 'u10', rank: 11, displayName: 'Quinn Nakamura', score: 83.6, streakDays: 1, trend: 'up' },
  { userId: 'u11', rank: 12, displayName: 'Reese Tanaka', score: 82.2, streakDays: 1, trend: 'down' },
  { userId: 'u12', rank: 13, displayName: 'Finley Cho', score: 80.9, streakDays: 1, trend: 'stable' },
];

const mockCurrentUser: LeaderboardEntry = {
  userId: 'current',
  rank: 6,
  displayName: 'You',
  score: 89.4,
  streakDays: 4,
  trend: 'up',
};

export function getMockLeaderboard(): LeaderboardResult {
  return {
    entries: mockLeaderboardEntries,
    totalParticipants: 47,
    currentUser: mockCurrentUser,
  };
}

// ── Friends mock data ─────────────────────────────────────────

export const mockFriends: Friend[] = [
  { friendshipId: 'f1', userId: 'u1', displayName: 'Alex Chen', lastActive: 'Worked out 2h ago', streakDays: 14, avgFormScore: 96.2 },
  { friendshipId: 'f2', userId: 'u3', displayName: 'Sam Rivera', lastActive: 'Worked out yesterday', streakDays: 7, avgFormScore: 93.1 },
  { friendshipId: 'f3', userId: 'u5', displayName: 'Morgan Wu', lastActive: 'Worked out 3 days ago', streakDays: 3, avgFormScore: 90.3 },
  { friendshipId: 'f4', userId: 'u8', displayName: 'Dakota Patel', lastActive: 'Worked out today', streakDays: 21, avgFormScore: 86.1 },
  { friendshipId: 'f5', userId: 'u10', displayName: 'Quinn Nakamura', lastActive: 'Worked out 5h ago', streakDays: 10, avgFormScore: 83.6 },
];

export const mockPendingRequests: FriendRequest[] = [
  { friendshipId: 'fr1', fromUserId: 'u4', fromDisplayName: 'Taylor Kim', sentAt: new Date(Date.now() - 3600000) },
  { friendshipId: 'fr2', fromUserId: 'u6', fromDisplayName: 'Casey Park', sentAt: new Date(Date.now() - 86400000) },
];

export const mockSuggestedFriends: SuggestedFriend[] = [
  { userId: 'u2', displayName: 'Jordan Lee', mutualFriendCount: 3 },
  { userId: 'u7', displayName: 'Riley Zhang', mutualFriendCount: 2 },
  { userId: 'u9', displayName: 'Avery Singh', mutualFriendCount: 2 },
  { userId: 'u11', displayName: 'Reese Tanaka', mutualFriendCount: 1 },
];

export const mockSearchResults: UserSearchResult[] = [
  { userId: 'u2', displayName: 'Jordan Lee', mutualFriendCount: 3, relationshipStatus: 'none', followStatus: 'none' },
  { userId: 'u4', displayName: 'Taylor Kim', mutualFriendCount: 1, relationshipStatus: 'pending_received', followStatus: 'none' },
  { userId: 'u1', displayName: 'Alex Chen', mutualFriendCount: 0, relationshipStatus: 'friends', followStatus: 'mutual_follow' },
];

// ── Follow mock data ─────────────────────────────────────────

export const mockFollowers: FollowRelation[] = [
  { userId: 'u1', displayName: 'Alex Chen', followedAt: new Date(Date.now() - 7 * 86400000) },
  { userId: 'u3', displayName: 'Sam Rivera', followedAt: new Date(Date.now() - 14 * 86400000) },
  { userId: 'u5', displayName: 'Morgan Wu', followedAt: new Date(Date.now() - 3 * 86400000) },
  { userId: 'u7', displayName: 'Riley Zhang', followedAt: new Date(Date.now() - 21 * 86400000) },
  { userId: 'u9', displayName: 'Avery Singh', followedAt: new Date(Date.now() - 2 * 86400000) },
  { userId: 'u11', displayName: 'Reese Tanaka', followedAt: new Date(Date.now() - 10 * 86400000) },
];

export const mockFollowing: FollowRelation[] = [
  { userId: 'u1', displayName: 'Alex Chen', followedAt: new Date(Date.now() - 7 * 86400000) },
  { userId: 'u3', displayName: 'Sam Rivera', followedAt: new Date(Date.now() - 14 * 86400000) },
  { userId: 'u5', displayName: 'Morgan Wu', followedAt: new Date(Date.now() - 3 * 86400000) },
  { userId: 'u8', displayName: 'Dakota Patel', followedAt: new Date(Date.now() - 5 * 86400000) },
];

// ── Friend Profile & Comparison mock data ─────────────────────

export function getMockFriendProfile(userId: string): FriendProfileData {
  const friend = mockFriends.find(f => f.userId === userId);
  return {
    userId,
    displayName: friend?.displayName ?? 'Unknown User',
    memberSince: new Date('2025-06-15'),
    totalWorkouts: 48,
    streakDays: friend?.streakDays ?? 0,
    avgFormScore: friend?.avgFormScore ?? 0,
    earnedBadgeIds: ['1', '2'],
    recentWorkouts: [
      { id: 'w1', name: 'Push Day', date: 'Feb 27', fullDate: new Date('2026-02-27'), duration: '42 min', totalSets: 12, totalReps: 96, formScore: 91, userId },
      { id: 'w2', name: 'Pull Day', date: 'Feb 25', fullDate: new Date('2026-02-25'), duration: '38 min', totalSets: 10, totalReps: 80, formScore: 88, userId },
      { id: 'w3', name: 'Leg Day', date: 'Feb 23', fullDate: new Date('2026-02-23'), duration: '50 min', totalSets: 15, totalReps: 120, formScore: 85, userId },
    ],
    isFollowing: mockFollowing.some(f => f.userId === userId),
    isFollowedBy: mockFollowers.some(f => f.userId === userId),
  };
}

export function getMockComparison(friendId: string): ComparisonData {
  const friend = mockFriends.find(f => f.userId === friendId);
  return {
    you: {
      userId: 'current',
      displayName: 'You',
      avgFormScore: 78.4,
      streakDays: 5,
      weeklyWorkouts: 3,
      bestSetScore: 95,
      totalPoints: 197,
    },
    friend: {
      userId: friendId,
      displayName: friend?.displayName ?? 'Friend',
      avatarUrl: undefined,
      avgFormScore: friend?.avgFormScore ?? 85,
      streakDays: friend?.streakDays ?? 7,
      weeklyWorkouts: 4,
      bestSetScore: 98,
      totalPoints: 340,
    },
  };
}

// ── Activity feed mock data ───────────────────────────────────

const now = Date.now();

const mockActivityEvents: ActivityEvent[] = [
  {
    id: 'ae1', userId: 'u1', displayName: 'Alex Chen', eventType: 'workout_completed',
    payload: { form_score: 96, duration: '42 min', exercise_count: 4 },
    createdAt: new Date(now - 2 * 3600000),
  },
  {
    id: 'ae2', userId: 'u3', displayName: 'Sam Rivera', eventType: 'badge_earned',
    payload: { badge_name: 'Form Seeker', badge_color: '#CD7F32' },
    createdAt: new Date(now - 5 * 3600000),
  },
  {
    id: 'ae3', userId: 'u5', displayName: 'Morgan Wu', eventType: 'personal_record',
    payload: { exercise: 'Barbell Curl', weight: 45, previous_weight: 40 },
    createdAt: new Date(now - 8 * 3600000),
  },
  {
    id: 'ae4', userId: 'u8', displayName: 'Dakota Patel', eventType: 'workout_completed',
    payload: { form_score: 88, duration: '55 min', exercise_count: 5 },
    createdAt: new Date(now - 12 * 3600000),
  },
  {
    id: 'ae5', userId: 'u10', displayName: 'Quinn Nakamura', eventType: 'streak_milestone',
    payload: { streak_days: 10 },
    createdAt: new Date(now - 18 * 3600000),
  },
  {
    id: 'ae6', userId: 'current', displayName: 'You', eventType: 'workout_completed',
    payload: { form_score: 82, duration: '38 min', exercise_count: 3 },
    createdAt: new Date(now - 24 * 3600000),
  },
  {
    id: 'ae7', userId: 'u1', displayName: 'Alex Chen', eventType: 'personal_record',
    payload: { exercise: 'Push-Up', weight: 0, reps: 50 },
    createdAt: new Date(now - 30 * 3600000),
  },
  {
    id: 'ae8', userId: 'u3', displayName: 'Sam Rivera', eventType: 'workout_completed',
    payload: { form_score: 91, duration: '45 min', exercise_count: 4 },
    createdAt: new Date(now - 36 * 3600000),
  },
  {
    id: 'ae9', userId: 'u5', displayName: 'Morgan Wu', eventType: 'badge_earned',
    payload: { badge_name: 'Consistent', badge_color: '#9CA3AF' },
    createdAt: new Date(now - 48 * 3600000),
  },
  {
    id: 'ae10', userId: 'u8', displayName: 'Dakota Patel', eventType: 'streak_milestone',
    payload: { streak_days: 21 },
    createdAt: new Date(now - 60 * 3600000),
  },
];

export function getMockActivityFeed(
  filter: string = 'all',
  cursor: string | null = null,
  limit: number = 20,
): ActivityFeedPage {
  let filtered = mockActivityEvents;

  if (filter === 'workouts') {
    filtered = filtered.filter(e => e.eventType === 'workout_completed');
  } else if (filter === 'badges') {
    filtered = filtered.filter(e => e.eventType === 'badge_earned');
  } else if (filter === 'records') {
    filtered = filtered.filter(e => e.eventType === 'personal_record' || e.eventType === 'streak_milestone');
  }

  let startIndex = 0;
  if (cursor) {
    const cursorIdx = filtered.findIndex(e => e.id === cursor);
    if (cursorIdx >= 0) startIndex = cursorIdx + 1;
  }

  const page = filtered.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < filtered.length;

  return {
    events: page,
    nextCursor: page.length > 0 ? page[page.length - 1].id : null,
    hasMore,
  };
}

// ── Reactions mock data ─────────────────────────────────────

const MOCK_CURRENT_USER_ID = 'current';
// Map<eventId, Map<userId, ReactionType>> — each user has at most one reaction per event
const reactionStore = new Map<string, Map<string, ReactionType>>();

// Seed some initial reactions for visual interest
(function seedReactions() {
  const seeds: Record<string, Record<string, ReactionType>> = {
    'ae1': { 'u3': 'like', 'u5': 'muscle', 'u8': 'like', 'u10': 'fire' },
    'ae2': { 'u1': 'fire', 'u5': 'fire', 'u8': 'clap', 'u10': 'clap' },
    'ae3': { 'u1': 'like', 'u3': 'muscle', 'u8': 'like', 'u10': 'like' },
    'ae5': { 'u1': 'like', 'u3': 'fire', 'u5': 'clap' },
  };
  for (const [eventId, userReactions] of Object.entries(seeds)) {
    const eventMap = new Map<string, ReactionType>();
    for (const [userId, type] of Object.entries(userReactions)) {
      eventMap.set(userId, type);
    }
    reactionStore.set(eventId, eventMap);
  }
})();

function computeCounts(eventMap: Map<string, ReactionType>): ReactionCounts {
  const counts: ReactionCounts = { like: 0, muscle: 0, fire: 0, clap: 0 };
  for (const type of eventMap.values()) {
    counts[type]++;
  }
  return counts;
}

export function getMockReactionsForEvents(
  eventIds: string[],
): Record<string, EventReactions> {
  const result: Record<string, EventReactions> = {};

  for (const eventId of eventIds) {
    const eventMap = reactionStore.get(eventId);
    if (eventMap) {
      result[eventId] = {
        counts: computeCounts(eventMap),
        userReaction: eventMap.get(MOCK_CURRENT_USER_ID) ?? null,
      };
    } else {
      result[eventId] = {
        counts: { like: 0, muscle: 0, fire: 0, clap: 0 },
        userReaction: null,
      };
    }
  }
  return result;
}

export function toggleMockReaction(
  eventId: string,
  reactionType: ReactionType,
): { added: boolean; previousReaction: ReactionType | null } {
  if (!reactionStore.has(eventId)) {
    reactionStore.set(eventId, new Map());
  }
  const eventMap = reactionStore.get(eventId)!;
  const current = eventMap.get(MOCK_CURRENT_USER_ID) ?? null;

  if (current === reactionType) {
    // Same reaction — remove it
    eventMap.delete(MOCK_CURRENT_USER_ID);
    return { added: false, previousReaction: current };
  } else {
    // Different or no reaction — set the new one
    eventMap.set(MOCK_CURRENT_USER_ID, reactionType);
    return { added: true, previousReaction: current };
  }
}
