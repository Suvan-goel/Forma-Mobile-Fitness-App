import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Path,
  Circle,
  Line,
  Rect,
  G,
  Text as SvgText,
} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_SHADOW,
} from '../constants/theme';

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
    subtext: 'Turn good reps into perfect ones with instant corrections.',
  },
  {
    id: '3',
    superHeader: 'Track your',
    header: 'PROGRESS',
    subtext: 'Watch your form scores climb as you build the habits of a perfect lifter.',
  },
];

// ── SVG Vectors ─────────────────────────────────────────────

/** Slide 1: Movement arc with keypoints, angle indicator, score badge */
const MovementVector: React.FC = () => (
  <Svg width={290} height={220} viewBox="0 0 290 220">
    {/* Background dot grid */}
    {([52, 104, 156, 208] as number[]).flatMap(x =>
      ([38, 88, 138, 182] as number[]).map(y => (
        <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} fill="rgba(139,92,246,0.13)" />
      ))
    )}

    {/* Filled area under movement arc */}
    <Path
      d="M 25 196 C 65 174, 85 124, 106 102 C 127 80, 148 74, 168 84 C 188 94, 208 116, 252 38 L 252 196 Z"
      fill="rgba(139,92,246,0.055)"
    />

    {/* Glow layer behind arc */}
    <Path
      d="M 25 196 C 65 174, 85 124, 106 102 C 127 80, 148 74, 168 84 C 188 94, 208 116, 252 38"
      stroke="rgba(139,92,246,0.22)"
      strokeWidth={7}
      fill="none"
      strokeLinecap="round"
    />

    {/* Main movement arc */}
    <Path
      d="M 25 196 C 65 174, 85 124, 106 102 C 127 80, 148 74, 168 84 C 188 94, 208 116, 252 38"
      stroke={COLORS.primary}
      strokeWidth={2.5}
      fill="none"
      strokeLinecap="round"
    />

    {/* Dashed drop lines from keypoints to baseline */}
    <Line x1={106} y1={104} x2={106} y2={198} stroke={COLORS.primary} strokeWidth={0.8} opacity={0.12} strokeDasharray="3,5" />
    <Line x1={168} y1={86} x2={168} y2={198} stroke={COLORS.primary} strokeWidth={0.8} opacity={0.12} strokeDasharray="3,5" />
    <Line x1={252} y1={42} x2={252} y2={198} stroke={COLORS.primary} strokeWidth={0.8} opacity={0.12} strokeDasharray="3,5" />

    {/* Keypoint 1 */}
    <Circle cx={25} cy={196} r={3} fill={COLORS.primary} opacity={0.2} />
    {/* Keypoint 2 */}
    <Circle cx={106} cy={102} r={10} fill={COLORS.primary} opacity={0.08} />
    <Circle cx={106} cy={102} r={4.5} fill={COLORS.primary} opacity={0.55} />
    {/* Keypoint 3 */}
    <Circle cx={168} cy={84} r={10} fill={COLORS.primary} opacity={0.08} />
    <Circle cx={168} cy={84} r={4.5} fill={COLORS.primary} opacity={0.7} />

    {/* Angle arc at midpoint keypoint */}
    <Path
      d="M 122 111 A 22 22 0 0 1 140 94"
      stroke={COLORS.primary}
      strokeWidth={1.5}
      fill="none"
      opacity={0.6}
      strokeLinecap="round"
    />
    {/* Angle tick marks */}
    <Line x1={122} y1={114} x2={125} y2={110} stroke={COLORS.primary} strokeWidth={1} opacity={0.4} />
    <Line x1={141} y1={92} x2={138} y2={96} stroke={COLORS.primary} strokeWidth={1} opacity={0.4} />
    {/* Angle label */}
    <Rect x={133} y={79} width={36} height={15} rx={3} fill="rgba(0,0,0,0.65)" />
    <SvgText x={151} y={90} fill={COLORS.primary} fontSize={8.5} textAnchor="middle" fontFamily="Courier New" opacity={0.9}>142°</SvgText>

    {/* Active endpoint — multi-ring glow */}
    <Circle cx={252} cy={38} r={40} fill={COLORS.primary} opacity={0.03} />
    <Circle cx={252} cy={38} r={28} fill={COLORS.primary} opacity={0.06} />
    <Circle cx={252} cy={38} r={18} fill={COLORS.primary} opacity={0.13} />
    <Circle cx={252} cy={38} r={8} fill={COLORS.primary} />
    <Circle cx={252} cy={38} r={3.5} fill="#FFFFFF" opacity={0.9} />

    {/* Score badge */}
    <Rect x={196} y={17} width={76} height={22} rx={5} fill="rgba(139,92,246,0.1)" stroke="rgba(139,92,246,0.3)" strokeWidth={0.8} />
    <SvgText x={234} y={32} fill={COLORS.primary} fontSize={9} textAnchor="middle" fontFamily="Courier New" opacity={0.85}>FORM  96/100</SvgText>

    {/* Baseline rule */}
    <Line x1={10} y1={202} x2={278} y2={202} stroke="rgba(255, 255, 255, 0.055)" strokeWidth={1} />
  </Svg>
);

/** Slide 2: Camera tracking frame with pose skeleton, scan overlay, confidence bar */
const PrecisionVector: React.FC = () => (
  <Svg width={280} height={230} viewBox="0 0 280 230">
    {/* Background ambient rings */}
    <Circle cx={140} cy={113} r={108} fill="rgba(139,92,246,0.02)" />
    <Circle cx={140} cy={113} r={82} fill="rgba(139,92,246,0.03)" />

    {/* Corner brackets */}
    <Path d="M 55 48 L 26 48 L 26 94" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
    <Path d="M 225 48 L 254 48 L 254 94" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
    <Path d="M 55 178 L 26 178 L 26 132" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
    <Path d="M 225 178 L 254 178 L 254 132" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />

    {/* Corner accent dots with halos */}
    {([{ cx: 26, cy: 48 }, { cx: 254, cy: 48 }, { cx: 26, cy: 178 }, { cx: 254, cy: 178 }] as { cx: number; cy: number }[]).map((pt, i) => (
      <G key={i}>
        <Circle cx={pt.cx} cy={pt.cy} r={11} fill={COLORS.primary} opacity={0.07} />
        <Circle cx={pt.cx} cy={pt.cy} r={4} fill={COLORS.primary} opacity={0.65} />
      </G>
    ))}

    {/* Tick marks on left bracket */}
    {([100, 113, 126] as number[]).map(y => (
      <Line key={y} x1={26} y1={y} x2={35} y2={y} stroke={COLORS.primary} strokeWidth={1} opacity={0.28} />
    ))}
    {/* Tick marks on right bracket */}
    {([100, 113, 126] as number[]).map(y => (
      <Line key={y} x1={245} y1={y} x2={254} y2={y} stroke={COLORS.primary} strokeWidth={1} opacity={0.28} />
    ))}

    {/* Horizontal scan line */}
    <Line x1={32} y1={113} x2={248} y2={113} stroke={COLORS.primary} strokeWidth={0.8} opacity={0.18} />
    <Line x1={32} y1={113} x2={248} y2={113} stroke={COLORS.primary} strokeWidth={5} opacity={0.04} />

    {/* Center crosshair */}
    <Line x1={126} y1={113} x2={154} y2={113} stroke={COLORS.primary} strokeWidth={1.5} opacity={0.35} />
    <Line x1={140} y1={99} x2={140} y2={127} stroke={COLORS.primary} strokeWidth={1.5} opacity={0.35} />

    {/* Confidence bar */}
    <SvgText x={140} y={207} fill="rgba(255,255,255,0.28)" fontSize={7.5} textAnchor="middle" fontFamily="Courier New">TRACKING CONFIDENCE</SvgText>
    <Rect x={76} y={212} width={128} height={4} rx={2} fill="rgba(139,92,246,0.15)" />
    <Rect x={76} y={212} width={106} height={4} rx={2} fill={COLORS.primary} opacity={0.65} />
    <Circle cx={182} cy={214} r={5.5} fill={COLORS.primary} opacity={0.85} />
    <Circle cx={182} cy={214} r={10} fill={COLORS.primary} opacity={0.12} />
  </Svg>
);

/** Slide 3: Ascending bar chart with trend line, score labels, week markers */
const ProgressVector: React.FC = () => {
  const baseline = 188;
  const barW = 24;
  const bars = [
    { x: 30,  h: 50,  score: '68' },
    { x: 76,  h: 68,  score: '74' },
    { x: 122, h: 90,  score: '82' },
    { x: 168, h: 113, score: '89' },
    { x: 214, h: 136, score: '94' },
    { x: 252, h: 152, score: '97' },
  ];
  const opacities = [0.28, 0.4, 0.55, 0.68, 0.82, 1.0];

  return (
    <Svg width={290} height={220} viewBox="0 0 290 220">
      {/* Horizontal grid lines */}
      <Line x1={16} y1={baseline}       x2={278} y2={baseline}       stroke="rgba(255, 255, 255, 0.055)" strokeWidth={1} />
      <Line x1={16} y1={baseline - 50}  x2={278} y2={baseline - 50}  stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} />
      <Line x1={16} y1={baseline - 100} x2={278} y2={baseline - 100} stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} />
      <Line x1={16} y1={baseline - 150} x2={278} y2={baseline - 150} stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} />

      {/* Grid labels */}
      <SvgText x={11} y={baseline - 46}  fill="rgba(255,255,255,0.2)" fontSize={7.5} textAnchor="end" fontFamily="Courier New">50</SvgText>
      <SvgText x={11} y={baseline - 96}  fill="rgba(255,255,255,0.2)" fontSize={7.5} textAnchor="end" fontFamily="Courier New">75</SvgText>
      <SvgText x={11} y={baseline - 146} fill="rgba(255,255,255,0.2)" fontSize={7.5} textAnchor="end" fontFamily="Courier New">100</SvgText>

      {/* Glow behind last (tallest) bar */}
      <Rect
        x={bars[5].x - barW / 2 - 5}
        y={baseline - bars[5].h - 5}
        width={barW + 10}
        height={bars[5].h + 5}
        rx={7}
        fill={COLORS.primary}
        opacity={0.18}
      />

      {/* Bar columns */}
      {bars.map((bar, i) => (
        <G key={i}>
          <Rect
            x={bar.x - barW / 2}
            y={baseline - bar.h}
            width={barW}
            height={bar.h}
            rx={5}
            fill={COLORS.primary}
            opacity={opacities[i] * 0.88}
          />
          {/* Score label */}
          <SvgText
            x={bar.x}
            y={baseline - bar.h - 7}
            fill={i === bars.length - 1 ? '#FFFFFF' : COLORS.primary}
            fontSize={i === bars.length - 1 ? 10 : 8.5}
            textAnchor="middle"
            fontFamily="Courier New"
            opacity={i === bars.length - 1 ? 1 : 0.6}
          >{bar.score}</SvgText>
          {/* Week label */}
          <SvgText
            x={bar.x}
            y={baseline + 14}
            fill="rgba(255,255,255,0.25)"
            fontSize={7.5}
            textAnchor="middle"
            fontFamily="Courier New"
          >{`W${i + 1}`}</SvgText>
        </G>
      ))}

      {/* Dashed trend line connecting bar tops */}
      <Path
        d={`M ${bars[0].x} ${baseline - bars[0].h} ${bars.slice(1).map(b => `L ${b.x} ${baseline - b.h}`).join(' ')}`}
        stroke={COLORS.primary}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.38}
        strokeDasharray="4,4"
      />

      {/* Glowing endpoint on trend line */}
      <Circle cx={bars[5].x} cy={baseline - bars[5].h} r={32} fill={COLORS.primary} opacity={0.04} />
      <Circle cx={bars[5].x} cy={baseline - bars[5].h} r={20} fill={COLORS.primary} opacity={0.08} />
      <Circle cx={bars[5].x} cy={baseline - bars[5].h} r={12} fill={COLORS.primary} opacity={0.14} />
      <Circle cx={bars[5].x} cy={baseline - bars[5].h} r={6} fill={COLORS.primary} />
      <Circle cx={bars[5].x} cy={baseline - bars[5].h} r={2.5} fill="#FFFFFF" opacity={0.9} />
    </Svg>
  );
};

const VECTORS = [MovementVector, PrecisionVector, ProgressVector];

// ── Slide Component ─────────────────────────────────────────

const CarouselSlide: React.FC<{ item: SlideData; index: number; width: number }> = ({ item, index, width }) => {
  const Vector = VECTORS[index];

  return (
    <View style={[slideStyles.container, { width }]}>
      <View style={slideStyles.content}>
        <LinearGradient
          colors={[...CARD_GRADIENT_ELEVATED]}
          start={CARD_GRADIENT_START}
          end={CARD_GRADIENT_END}
          style={slideStyles.artCard}
        >
          <View style={slideStyles.artCardEdge}>
            <View style={slideStyles.visualHeader}>
              <Text style={slideStyles.visualLabel}>FORMA AI</Text>
              <View style={slideStyles.livePill}>
                <View style={slideStyles.liveDot} />
                <Text style={slideStyles.liveText}>Live</Text>
              </View>
            </View>
            <View style={slideStyles.artSection}>
              <Vector />
            </View>
          </View>
        </LinearGradient>

        <View style={slideStyles.textSection}>
          <View style={slideStyles.superHeaderRow}>
            <View style={slideStyles.accentDash} />
            <Text style={slideStyles.superHeader}>{item.superHeader}</Text>
          </View>
          <Text style={slideStyles.header}>{item.header}</Text>
          <Text style={slideStyles.subtext}>{item.subtext}</Text>
        </View>
      </View>
    </View>
  );
};

const slideStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 22,
  },
  artCard: {
    minHeight: 316,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  artCardEdge: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    padding: 16,
  },
  visualHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 1.8,
  },
  livePill: {
    minHeight: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 9,
    backgroundColor: 'rgba(52, 224, 166, 0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(52, 224, 166, 0.20)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.green,
  },
  liveText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.green,
    letterSpacing: 0,
  },
  artSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  superHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  accentDash: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.primary,
    marginRight: 10,
    opacity: 0.8,
  },
  superHeader: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  header: {
    fontFamily: FONTS.display.bold,
    fontSize: 42,
    color: COLORS.text,
    letterSpacing: 0,
    lineHeight: 48,
    marginBottom: 11,
  },
  textSection: {
    paddingHorizontal: 4,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
    letterSpacing: 0,
  },
});

// ── Main Component ──────────────────────────────────────────

interface OnboardingCarouselProps {
  onComplete: () => void;
}

export const OnboardingCarousel: React.FC<OnboardingCarouselProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
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
      <CarouselSlide item={item} index={index} width={screenWidth} />
    ),
    [screenWidth],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: screenWidth,
      offset: screenWidth * index,
      index,
    }),
    [screenWidth],
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
              (i - 1) * screenWidth,
              i * screenWidth,
              (i + 1) * screenWidth,
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

        {/* CTA Button — outer view for JS-driven glow, inner for native-driven scale */}
        <Animated.View
          style={[
            styles.ctaWrapper,
            Platform.OS === 'ios' && {
              shadowColor: COLORS.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: glowOpacity as any,
              shadowRadius: glowRadius as any,
            },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <TouchableOpacity onPress={handleGetStarted} activeOpacity={0.85}>
              <View style={styles.ctaButton}>
                <Text style={styles.ctaText}>Get Started</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  carouselContainer: {
    flex: 1,
  },
  bottomControls: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 16,
    gap: 20,
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
    borderRadius: 12,
    overflow: 'visible',
  },
  ctaButton: {
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  ctaText: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0,
  },
});
