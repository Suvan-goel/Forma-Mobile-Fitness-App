/**
 * UserProfileScreen — Your own public-facing profile page.
 * Accessed by tapping the avatar in Logbook, Analytics, or Capture screens.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Menu,
  Edit2,
  Gift,
  BarChart2,
  Video,
  BookOpen,
  ChevronRight,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useUser, useWorkouts, useFriends, useAnalytics } from '../../backend/hooks';
import type { RootStackParamList } from '../app/RootNavigator';
import type { WorkoutBarData } from '../../backend/services/api';

type UserProfileNavigationProp = NativeStackNavigationProp<RootStackParamList>;

/* ── Mini Bar Chart ──────────────────────────────── */

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const MiniBarChart: React.FC<{ data: WorkoutBarData[] }> = ({ data }) => {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <View style={chartStyles.container}>
      {data.map((d, i) => {
        const heightPct = d.value > 0 ? Math.max(14, Math.round((d.value / maxVal) * 100)) : 4;
        return (
          <View key={i} style={chartStyles.barWrap}>
            <View style={chartStyles.barTrack}>
              <View
                style={[
                  chartStyles.barFill,
                  { height: `${heightPct}%` as any },
                  d.value === 0 && chartStyles.barEmpty,
                ]}
              />
            </View>
            <Text style={chartStyles.dayLabel}>{DAY_LABELS[i % 7]}</Text>
          </View>
        );
      })}
    </View>
  );
};

const chartStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 52,
    marginTop: 14,
  },
  barWrap: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
  },
  barTrack: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
    opacity: 0.9,
  },
  barEmpty: {
    opacity: 0.2,
    backgroundColor: COLORS.textTertiary,
  },
  dayLabel: {
    fontFamily: FONTS.mono.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    marginTop: 5,
    letterSpacing: 0.5,
  },
});

/* ── Stat Item ───────────────────────────────────── */

const StatItem: React.FC<{ value: string; label: string; dim?: boolean }> = ({
  value,
  label,
  dim,
}) => (
  <View style={styles.statItem}>
    <Text style={[styles.statValue, dim && styles.statValueDim]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

/* ── Link Card (navigable) ───────────────────────── */

const LinkCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress?: () => void;
  dimmed?: boolean;
}> = ({ icon, title, subtitle, onPress, dimmed }) => {
  const Inner = (
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.cardGradient}
    >
      <View style={styles.cardGlassEdge}>
        <View style={styles.cardRow}>
          <View style={[styles.cardIconWrap, dimmed && styles.cardIconWrapDim]}>
            {icon}
          </View>
          <View style={styles.cardTextWrap}>
            <Text style={[styles.cardTitle, dimmed && styles.cardTitleDim]}>{title}</Text>
            <Text style={styles.cardSubtitle}>{subtitle}</Text>
          </View>
          <ChevronRight size={18} color={COLORS.textTertiary} strokeWidth={1.5} />
        </View>
      </View>
    </LinearGradient>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.82}>
        {Inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.card}>{Inner}</View>;
};

/* ── Main Screen ─────────────────────────────────── */

export const UserProfileScreen: React.FC = () => {
  const navigation = useNavigation<UserProfileNavigationProp>();
  const insets = useSafeAreaInsets();

  const { user } = useUser();
  const { workouts } = useWorkouts();
  const { friends } = useFriends();
  const { analytics } = useAnalytics('1 week', 4);

  const workoutCount = workouts.length;
  const friendsCount = friends.length;
  const weeklyBarData = analytics?.weeklyBarData ?? [];
  const totalMinutes = analytics?.summary.totalDurationMinutes ?? 0;

  const handleGoBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleEditProfile = useCallback(() => navigation.navigate('ProfileSettings'), [navigation]);
  const handleRewards = useCallback(() => navigation.navigate('Rewards'), [navigation]);
  const handleTutorials = useCallback(() => navigation.navigate('Tutorials'), [navigation]);

  const initial = user?.displayName ? user.displayName[0].toUpperCase() : '?';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={handleGoBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PROFILE</Text>
        <TouchableOpacity style={styles.headerBtn} onPress={handleSettings} activeOpacity={0.7}>
          <Menu size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* ── Profile Hero ────────────────────── */}
        <View style={styles.profileSection}>
          {/* Avatar */}
          <View style={styles.avatarRing}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <LinearGradient
                colors={['#9F75FF', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatarGradient}
              >
                <Text style={styles.avatarInitial}>{initial}</Text>
              </LinearGradient>
            )}
          </View>

          <Text style={styles.displayName}>{user?.displayName ?? ''}</Text>

          {user?.bio ? (
            <Text style={styles.bio}>{user.bio}</Text>
          ) : null}

          {/* Edit Profile */}
          <TouchableOpacity
            style={styles.editButton}
            onPress={handleEditProfile}
            activeOpacity={0.8}
          >
            <Edit2 size={13} color={COLORS.primary} strokeWidth={2} />
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* ── Stats Row ──────────────────────── */}
        <View style={styles.statsCard}>
          <StatItem value={String(workoutCount)} label="Workouts" />
          <View style={styles.statDivider} />
          <StatItem value="0" label="Followers" dim />
          <View style={styles.statDivider} />
          <StatItem value="0" label="Following" dim />
          <View style={styles.statDivider} />
          <StatItem value={String(friendsCount)} label="Friends" />
        </View>

        {/* ── Rewards Card ───────────────────── */}
        <LinkCard
          icon={<Gift size={20} color={COLORS.primary} strokeWidth={1.5} />}
          title="Rewards"
          subtitle="View your badges & points"
          onPress={handleRewards}
        />

        {/* ── Progress Card ───────────────────── */}
        <View style={styles.card}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              <View style={styles.cardRow}>
                <View style={styles.cardIconWrap}>
                  <BarChart2 size={20} color={COLORS.primary} strokeWidth={1.5} />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={styles.cardTitle}>Progress</Text>
                  <Text style={styles.cardSubtitle}>Minutes active this week</Text>
                </View>
                <View style={styles.minutesBadge}>
                  <Text style={styles.minutesValue}>{totalMinutes}</Text>
                  <Text style={styles.minutesUnit}>min</Text>
                </View>
              </View>
              {weeklyBarData.length > 0 && <MiniBarChart data={weeklyBarData} />}
            </View>
          </LinearGradient>
        </View>

        {/* ── Video Library Card ─────────────── */}
        <LinkCard
          icon={<Video size={20} color={COLORS.textTertiary} strokeWidth={1.5} />}
          title="Video Library"
          subtitle="Your recorded workouts · Coming soon"
          dimmed
        />

        {/* ── Tutorials Card ─────────────────── */}
        <LinkCard
          icon={<BookOpen size={20} color={COLORS.primary} strokeWidth={1.5} />}
          title="Exercise Tutorials"
          subtitle="Browse exercise guides"
          onPress={handleTutorials}
        />
      </ScrollView>
    </View>
  );
};

/* ── Styles ──────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: 12,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 2.5,
  },

  /* Scroll */
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 8,
  },

  /* Profile hero */
  profileSection: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 28,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2.5,
    borderColor: 'rgba(139, 92, 246, 0.55)',
    padding: 2,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 18,
      },
      android: { elevation: 6 },
    }),
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 44,
  },
  avatarGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 34,
    color: COLORS.text,
  },
  displayName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  bio: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    marginTop: 4,
  },
  editButtonText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.primary,
    letterSpacing: 0.3,
  },

  /* Stats card */
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: SPACING.md,
    marginBottom: 4,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  statValueDim: {
    color: COLORS.textTertiary,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },

  /* Cards */
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  cardGradient: {
    borderRadius: 20,
  },
  cardGlassEdge: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: SPACING.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconWrapDim: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardTextWrap: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  cardTitleDim: {
    color: COLORS.textSecondary,
  },
  cardSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  /* Progress card extras */
  minutesBadge: {
    alignItems: 'center',
  },
  minutesValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
    color: COLORS.primary,
    letterSpacing: -0.5,
    lineHeight: 26,
  },
  minutesUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
