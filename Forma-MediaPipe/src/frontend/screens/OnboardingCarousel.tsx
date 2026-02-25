import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Slide Data ──────────────────────────────────────────────
interface SlideData {
  id: string;
  superHeader: string;
  header: string;
  subtext: string;
}

const SLIDES: SlideData[] = [
  {
    id: '1',
    superHeader: 'Master your',
    header: 'MOVEMENT',
    subtext: 'AI-powered form analysis that watches every rep so you can train with confidence.',
  },
  {
    id: '2',
    superHeader: 'Achieve',
    header: 'PRECISION',
    subtext: 'Real-time tracking brackets lock onto your joints to measure what matters.',
  },
  {
    id: '3',
    superHeader: 'Track your',
    header: 'PROGRESS',
    subtext: 'Watch your form scores climb as you build the habits of a perfect lifter.',
  },
];

// ── SVG Vectors ─────────────────────────────────────────────

const BarPathVector: React.FC = () => (
  <Svg width={220} height={180} viewBox="0 0 220 180">
    <Path
      d="M 20 160 Q 60 140, 80 100 Q 100 60, 120 50 Q 140 40, 160 60 Q 180 80, 200 20"
      stroke={COLORS.primary}
      strokeWidth={2.5}
      fill="none"
      strokeLinecap="round"
    />
    <Circle cx={200} cy={20} r={5} fill={COLORS.primary} opacity={0.9} />
    <Circle cx={200} cy={20} r={12} fill={COLORS.primary} opacity={0.15} />
    <Circle cx={200} cy={20} r={20} fill={COLORS.primary} opacity={0.06} />
  </Svg>
);

const TrackingBracketsVector: React.FC = () => (
  <Svg width={200} height={160} viewBox="0 0 200 160">
    {/* Left bracket */}
    <Path
      d="M 40 30 L 20 30 L 20 130 L 40 130"
      stroke={COLORS.primary}
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.7}
    />
    {/* Right bracket */}
    <Path
      d="M 160 30 L 180 30 L 180 130 L 160 130"
      stroke={COLORS.primary}
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.7}
    />
    {/* Center crosshair */}
    <Line x1={90} y1={80} x2={110} y2={80} stroke={COLORS.primary} strokeWidth={1.5} opacity={0.5} />
    <Line x1={100} y1={70} x2={100} y2={90} stroke={COLORS.primary} strokeWidth={1.5} opacity={0.5} />
    {/* Corner accents */}
    <Circle cx={20} cy={30} r={2.5} fill={COLORS.primary} opacity={0.6} />
    <Circle cx={180} cy={30} r={2.5} fill={COLORS.primary} opacity={0.6} />
    <Circle cx={20} cy={130} r={2.5} fill={COLORS.primary} opacity={0.6} />
    <Circle cx={180} cy={130} r={2.5} fill={COLORS.primary} opacity={0.6} />
  </Svg>
);

const SparklineVector: React.FC = () => (
  <Svg width={200} height={160} viewBox="0 0 200 160">
    {/* Sparkline */}
    <Path
      d="M 30 130 L 90 90 L 170 30"
      stroke={COLORS.primary}
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Data points */}
    <Circle cx={30} cy={130} r={4} fill={COLORS.primary} opacity={0.4} />
    <Circle cx={90} cy={90} r={4} fill={COLORS.primary} opacity={0.6} />
    {/* Glowing endpoint */}
    <Circle cx={170} cy={30} r={6} fill={COLORS.primary} />
    <Circle cx={170} cy={30} r={14} fill={COLORS.primary} opacity={0.15} />
    <Circle cx={170} cy={30} r={24} fill={COLORS.primary} opacity={0.06} />
    {/* Faint baseline */}
    <Line x1={20} y1={140} x2={190} y2={140} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
  </Svg>
);

const VECTORS = [BarPathVector, TrackingBracketsVector, SparklineVector];

// ── Slide Component ─────────────────────────────────────────

const CarouselSlide: React.FC<{ item: SlideData; index: number }> = ({ item, index }) => {
  const Vector = VECTORS[index];

  return (
    <View style={[slideStyles.container, { width: SCREEN_WIDTH }]}>
      {/* Top 60%: Art + Header */}
      <View style={slideStyles.artSection}>
        <View style={slideStyles.vectorWrap}>
          <Vector />
        </View>
        <Text style={slideStyles.superHeader}>{item.superHeader}</Text>
        <Text style={slideStyles.header}>{item.header}</Text>
      </View>
      {/* Bottom 40%: Subtext */}
      <View style={slideStyles.textSection}>
        <Text style={slideStyles.subtext}>{item.subtext}</Text>
      </View>
    </View>
  );
};

const slideStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  artSection: {
    flex: 0.6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 20,
  },
  vectorWrap: {
    marginBottom: 40,
  },
  superHeader: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  header: {
    fontFamily: FONTS.display.bold,
    fontSize: 64,
    color: COLORS.text,
    letterSpacing: -2,
    lineHeight: 68,
  },
  textSection: {
    flex: 0.4,
    paddingHorizontal: 40,
    paddingTop: 24,
    alignItems: 'center',
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
});

// ── Main Component ──────────────────────────────────────────

interface OnboardingCarouselProps {
  onComplete: () => void;
}

export const OnboardingCarousel: React.FC<OnboardingCarouselProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonScale = useRef(new Animated.Value(1)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;

  // Pulse glow on CTA when on last slide
  React.useEffect(() => {
    if (activeIndex === SLIDES.length - 1) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(buttonGlow, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: false,
          }),
          Animated.timing(buttonGlow, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: false,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
    buttonGlow.setValue(0);
  }, [activeIndex, buttonGlow]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleGetStarted = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start(() => {
      onComplete();
    });
  }, [onComplete, buttonScale]);

  const renderItem = useCallback(
    ({ item, index }: { item: SlideData; index: number }) => (
      <CarouselSlide item={item} index={index} />
    ),
    [],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: SCREEN_WIDTH,
      offset: SCREEN_WIDTH * index,
      index,
    }),
    [],
  );

  const glowOpacity = buttonGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0.85],
  });

  const glowRadius = buttonGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 30],
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Carousel */}
      <View style={styles.carouselContainer}>
        <Animated.FlatList
          ref={flatListRef}
          data={SLIDES}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
        />
      </View>

      {/* Bottom: Pagination + CTA */}
      <View style={styles.bottomControls}>
        {/* Pagination Dots */}
        <View style={styles.paginationRow}>
          {SLIDES.map((_, i) => {
            const inputRange = [
              (i - 1) * SCREEN_WIDTH,
              i * SCREEN_WIDTH,
              (i + 1) * SCREEN_WIDTH,
            ];
            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [6, 24, 6],
              extrapolate: 'clamp',
            });
            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  {
                    width: dotWidth,
                    opacity: dotOpacity,
                    backgroundColor: COLORS.primary,
                  },
                ]}
              />
            );
          })}
        </View>

        {/* CTA Button */}
        <Animated.View
          style={[
            styles.ctaWrapper,
            {
              transform: [{ scale: buttonScale }],
            },
            Platform.OS === 'ios' && {
              shadowColor: COLORS.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: glowOpacity as any,
              shadowRadius: glowRadius as any,
            },
          ]}
        >
          <TouchableOpacity onPress={handleGetStarted} activeOpacity={0.85}>
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.ctaButton}
            >
              <Text style={styles.ctaText}>Get Started</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  carouselContainer: {
    flex: 1,
  },
  bottomControls: {
    paddingHorizontal: SPACING.screenHorizontal + 8,
    paddingBottom: 16,
    gap: 24,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  ctaWrapper: {
    borderRadius: 28,
    overflow: 'visible',
  },
  ctaButton: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0.5,
  },
});
