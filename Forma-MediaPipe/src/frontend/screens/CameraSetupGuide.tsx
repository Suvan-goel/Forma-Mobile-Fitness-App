import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Rect, G, Ellipse } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_SLIDES = 3;

// ── SVG: Tilted Phone on Floor Grid (Slide 0) ──────────────────

const PhoneSetupVector: React.FC = () => (
  <Svg width={260} height={280} viewBox="0 0 260 280">
    {/* Floor glow — concentric ellipses */}
    <Ellipse cx={130} cy={248} rx={110} ry={28} fill={COLORS.primary} opacity={0.06} />
    <Ellipse cx={130} cy={248} rx={65} ry={16} fill={COLORS.primary} opacity={0.09} />

    {/* Perspective grid — horizontal floor lines */}
    <Line x1={35} y1={232} x2={225} y2={232} stroke="rgba(139, 92, 246, 0.10)" strokeWidth={0.7} />
    <Line x1={45} y1={242} x2={215} y2={242} stroke="rgba(139, 92, 246, 0.07)" strokeWidth={0.7} />
    <Line x1={55} y1={252} x2={205} y2={252} stroke="rgba(139, 92, 246, 0.05)" strokeWidth={0.7} />
    <Line x1={65} y1={262} x2={195} y2={262} stroke="rgba(139, 92, 246, 0.03)" strokeWidth={0.7} />

    {/* Perspective grid — converging radials */}
    <Line x1={130} y1={222} x2={30} y2={272} stroke="rgba(139, 92, 246, 0.06)" strokeWidth={0.5} />
    <Line x1={130} y1={222} x2={65} y2={272} stroke="rgba(139, 92, 246, 0.05)" strokeWidth={0.5} />
    <Line x1={130} y1={222} x2={100} y2={272} stroke="rgba(139, 92, 246, 0.04)" strokeWidth={0.5} />
    <Line x1={130} y1={222} x2={160} y2={272} stroke="rgba(139, 92, 246, 0.04)" strokeWidth={0.5} />
    <Line x1={130} y1={222} x2={195} y2={272} stroke="rgba(139, 92, 246, 0.05)" strokeWidth={0.5} />
    <Line x1={130} y1={222} x2={230} y2={272} stroke="rgba(139, 92, 246, 0.06)" strokeWidth={0.5} />

    {/* Phone — tilted ~15deg back (75deg from floor) */}
    <G rotation={-12} origin="130, 125">
      {/* Outer glow aura */}
      <Rect x={86} y={26} width={88} height={178} rx={16}
        stroke={COLORS.primary} strokeWidth={1.5} fill="none" opacity={0.08} />
      {/* Phone chassis */}
      <Rect x={92} y={32} width={76} height={166} rx={13}
        stroke={COLORS.primary} strokeWidth={2} fill="rgba(139, 92, 246, 0.03)" />
      {/* Screen bezel */}
      <Rect x={99} y={48} width={62} height={132} rx={4}
        stroke="rgba(139, 92, 246, 0.18)" strokeWidth={0.8} fill="rgba(139, 92, 246, 0.02)" />
      {/* Front camera dot */}
      <Circle cx={130} cy={40} r={2} fill={COLORS.primary} opacity={0.55} />
      <Circle cx={130} cy={40} r={5.5} fill={COLORS.primary} opacity={0.08} />
      {/* Mini viewfinder brackets inside screen */}
      <Path d="M 110 72 L 110 62 L 120 62" stroke="rgba(139,92,246,0.30)" strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <Path d="M 150 72 L 150 62 L 140 62" stroke="rgba(139,92,246,0.30)" strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <Path d="M 110 154 L 110 164 L 120 164" stroke="rgba(139,92,246,0.30)" strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <Path d="M 150 154 L 150 164 L 140 164" stroke="rgba(139,92,246,0.30)" strokeWidth={1.2} fill="none" strokeLinecap="round" />
    </G>

    {/* Angle reference — vertical dashed guide + arc */}
    <Line x1={130} y1={225} x2={130} y2={200} stroke="rgba(255,255,255,0.10)" strokeWidth={0.8} strokeDasharray="3,3" />
    <Path d="M 130 213 Q 126 207, 123 202" stroke="rgba(139,92,246,0.20)" strokeWidth={0.8} fill="none" />
  </Svg>
);

// ── SVG: Viewfinder Brackets + Dotted Silhouette (Slide 1) ─────

const ViewfinderVector: React.FC = () => (
  <Svg width={260} height={280} viewBox="0 0 260 280">
    {/* Corner brackets */}
    <Path d="M 55 45 L 28 45 L 28 88" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M 205 45 L 232 45 L 232 88" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M 55 255 L 28 255 L 28 212" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M 205 255 L 232 255 L 232 212" stroke={COLORS.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

    {/* Corner accent dots */}
    <Circle cx={28} cy={45} r={3} fill={COLORS.primary} opacity={0.45} />
    <Circle cx={232} cy={45} r={3} fill={COLORS.primary} opacity={0.45} />
    <Circle cx={28} cy={255} r={3} fill={COLORS.primary} opacity={0.45} />
    <Circle cx={232} cy={255} r={3} fill={COLORS.primary} opacity={0.45} />

    {/* Human silhouette */}
    <Circle cx={130} cy={82} r={14} stroke="rgba(255,255,255,0.45)" strokeWidth={1.8} fill="none" strokeDasharray="4,3" />
    <Line x1={130} y1={96} x2={130} y2={108} stroke="rgba(255,255,255,0.35)" strokeWidth={1.8} strokeDasharray="3,3" />
    <Line x1={98} y1={113} x2={162} y2={113} stroke="rgba(255,255,255,0.38)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={98} y1={113} x2={88} y2={163} stroke="rgba(255,255,255,0.30)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={162} y1={113} x2={172} y2={163} stroke="rgba(255,255,255,0.30)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={108} y1={113} x2={108} y2={175} stroke="rgba(255,255,255,0.35)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={152} y1={113} x2={152} y2={175} stroke="rgba(255,255,255,0.35)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={103} y1={175} x2={157} y2={175} stroke="rgba(255,255,255,0.30)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={112} y1={175} x2={104} y2={238} stroke="rgba(255,255,255,0.30)" strokeWidth={1.8} strokeDasharray="4,3" />
    <Line x1={148} y1={175} x2={156} y2={238} stroke="rgba(255,255,255,0.30)" strokeWidth={1.8} strokeDasharray="4,3" />

    {/* Joint dots */}
    <Circle cx={98} cy={113} r={3} fill="rgba(255,255,255,0.30)" />
    <Circle cx={162} cy={113} r={3} fill="rgba(255,255,255,0.30)" />
    <Circle cx={108} cy={175} r={3} fill="rgba(255,255,255,0.30)" />
    <Circle cx={152} cy={175} r={3} fill="rgba(255,255,255,0.30)" />
  </Svg>
);

// ── SVG: Dimmed Camera Screen Wireframe (Slide 2) ──────────────
// The glowing ? icon + ripple rings are overlaid as Animated.Views

const HINT_ICON_CX = 58;
const HINT_ICON_CY = 55;

const HeaderHintVector: React.FC = () => (
  <Svg width={280} height={240} viewBox="0 0 280 240">
    {/* Phone frame (top portion) */}
    <Rect x={18} y={8} width={244} height={224} rx={24}
      stroke="rgba(255,255,255,0.06)" strokeWidth={1.2} fill="rgba(255,255,255,0.015)" />

    {/* Status bar hints */}
    <Rect x={38} y={22} width={24} height={5} rx={2.5} fill="rgba(255,255,255,0.07)" />
    <Rect x={218} y={22} width={14} height={5} rx={2} stroke="rgba(255,255,255,0.06)" strokeWidth={0.7} fill="none" />

    {/* Header bar fill */}
    <Rect x={18} y={36} width={244} height={38} fill="rgba(255,255,255,0.02)" />

    {/* Header separator */}
    <Line x1={28} y1={74} x2={252} y2={74} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />

    {/* ? icon placeholder (dimmed circle — the real one is an overlay) */}
    <Circle cx={HINT_ICON_CX} cy={HINT_ICON_CY} r={15}
      stroke="rgba(255,255,255,0.06)" strokeWidth={0.8} fill="none" />

    {/* Exercise title placeholder */}
    <Rect x={108} y={49} width={64} height={11} rx={4} fill="rgba(255,255,255,0.06)" />

    {/* Right-side icon placeholder */}
    <Circle cx={234} cy={52} r={1.5} fill="rgba(255,255,255,0.06)" />
    <Circle cx={234} cy={58} r={1.5} fill="rgba(255,255,255,0.06)" />

    {/* Camera content area — faint viewfinder brackets */}
    <Path d="M 55 95 L 38 95 L 38 115" stroke="rgba(255,255,255,0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />
    <Path d="M 225 95 L 242 95 L 242 115" stroke="rgba(255,255,255,0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />
    <Path d="M 55 195 L 38 195 L 38 175" stroke="rgba(255,255,255,0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />
    <Path d="M 225 195 L 242 195 L 242 175" stroke="rgba(255,255,255,0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />

    {/* Center crosshair */}
    <Line x1={131} y1={145} x2={149} y2={145} stroke="rgba(255,255,255,0.03)" strokeWidth={0.8} />
    <Line x1={140} y1={136} x2={140} y2={154} stroke="rgba(255,255,255,0.03)" strokeWidth={0.8} />

    {/* Bottom controls hint */}
    <Line x1={28} y1={210} x2={252} y2={210} stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
    <Circle cx={140} cy={224} r={8} stroke="rgba(255,255,255,0.05)" strokeWidth={1} fill="none" />
  </Svg>
);

// ── Main Component ──────────────────────────────────────────────

interface CameraSetupGuideProps {
  onComplete: () => void;
}

export const CameraSetupGuide: React.FC<CameraSetupGuideProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();
  const [currentSlide, setCurrentSlide] = useState(0);

  // Animation values
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;       // 0 → 1 → 2
  const bracketPulse = useRef(new Animated.Value(1)).current;
  const phoneGlow = useRef(new Animated.Value(0.25)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;

  // Ripple rings for slide 2
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const ripple3 = useRef(new Animated.Value(0)).current;
  const ripples = [ripple1, ripple2, ripple3];

  // ── Initial fade-in + phone glow loop ──
  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(phoneGlow, { toValue: 0.55, duration: 2000, useNativeDriver: false }),
        Animated.timing(phoneGlow, { toValue: 0.25, duration: 2000, useNativeDriver: false }),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [fadeIn, phoneGlow]);

  // ── Bracket pulse — slide 1 only ──
  useEffect(() => {
    if (currentSlide !== 1) {
      bracketPulse.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bracketPulse, { toValue: 1.035, duration: 1400, useNativeDriver: true }),
        Animated.timing(bracketPulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [currentSlide, bracketPulse]);

  // ── Ripple rings + CTA glow — slide 2 only ──
  useEffect(() => {
    if (currentSlide !== 2) {
      ripple1.setValue(0);
      ripple2.setValue(0);
      ripple3.setValue(0);
      buttonGlow.setValue(0);
      return;
    }

    const loops: Animated.CompositeAnimation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Stagger 3 ripple loops
    [ripple1, ripple2, ripple3].forEach((anim, i) => {
      const timer = setTimeout(() => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
        );
        loops.push(loop);
        loop.start();
      }, i * 600);
      timers.push(timer);
    });

    // CTA button glow
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(buttonGlow, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(buttonGlow, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ]),
    );
    glow.start();

    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
      glow.stop();
    };
  }, [currentSlide, ripple1, ripple2, ripple3, buttonGlow]);

  // ── Handlers ──
  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = currentSlide + 1;
    setCurrentSlide(next);
    Animated.timing(slideAnim, {
      toValue: next,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [currentSlide, slideAnim]);

  const handleOpenCamera = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start(() => onComplete());
  }, [onComplete, buttonScale]);

  // ── Cross-fade interpolations (3 slides: 0, 1, 2) ──
  const s0Opacity = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 0, 0] });
  const s0Tx = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, -30, -30] });
  const s1Opacity = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  const s1Tx = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [30, 0, -30] });
  const s2Opacity = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, 1] });
  const s2Tx = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [30, 30, 0] });

  // Pagination dots (3)
  const dot0W = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [20, 6, 6] });
  const dot0Op = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 0.3, 0.3] });
  const dot1W = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [6, 20, 6] });
  const dot1Op = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 0.3] });
  const dot2W = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [6, 6, 20] });
  const dot2Op = slideAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 0.3, 1] });

  // CTA glow
  const glowOp = buttonGlow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
  const glowRad = buttonGlow.interpolate({ inputRange: [0, 1], outputRange: [12, 25] });

  // Ripple ring helper
  const RING_SIZE = 34;
  const rippleRingStyle = (anim: Animated.Value) => ({
    position: 'absolute' as const,
    left: HINT_ICON_CX - RING_SIZE / 2,
    top: HINT_ICON_CY - RING_SIZE / 2,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    transform: [{
      scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }),
    }],
    opacity: anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.55, 0.2, 0] }),
  });

  return (
    <Animated.View style={[styles.root, { opacity: fadeIn, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* ── Top 60 %: SVG Art ─────────────────── */}
      <View style={styles.artSection}>
        {/* Slide 0 — Phone Setup */}
        <Animated.View style={[styles.slideLayer, { opacity: s0Opacity, transform: [{ translateX: s0Tx }] }]}>
          <Text style={styles.stepLabel}>THE SETUP</Text>
          <Animated.View style={[
            styles.vectorWrap,
            Platform.OS === 'ios' && {
              shadowColor: COLORS.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: phoneGlow as any,
              shadowRadius: 22,
            },
          ]}>
            <PhoneSetupVector />
          </Animated.View>
        </Animated.View>

        {/* Slide 1 — Viewfinder */}
        <Animated.View style={[styles.slideLayer, styles.slideLayerAbsolute, { opacity: s1Opacity, transform: [{ translateX: s1Tx }] }]}>
          <Text style={styles.stepLabel}>THE FRAME</Text>
          <Animated.View style={[styles.vectorWrap, { transform: [{ scale: bracketPulse }] }]}>
            <ViewfinderVector />
          </Animated.View>
        </Animated.View>

        {/* Slide 2 — Header Hint with Ripple */}
        <Animated.View style={[styles.slideLayer, styles.slideLayerAbsolute, { opacity: s2Opacity, transform: [{ translateX: s2Tx }] }]}>
          <Text style={styles.stepLabel}>PRO TIP</Text>
          <View style={styles.hintWrap}>
            <HeaderHintVector />
            {/* Ripple rings overlay */}
            <View style={styles.rippleOverlay} pointerEvents="none">
              {ripples.map((anim, i) => (
                <Animated.View key={i} style={rippleRingStyle(anim)} />
              ))}
              {/* Glowing ? icon */}
              <View style={styles.qIcon}>
                <Text style={styles.qText}>?</Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* ── Pagination Dots ───────────────────── */}
      <View style={styles.paginationRow}>
        <Animated.View style={[styles.dot, { width: dot0W, opacity: dot0Op, backgroundColor: COLORS.primary }]} />
        <Animated.View style={[styles.dot, { width: dot1W, opacity: dot1Op, backgroundColor: COLORS.primary }]} />
        <Animated.View style={[styles.dot, { width: dot2W, opacity: dot2Op, backgroundColor: COLORS.primary }]} />
      </View>

      {/* ── Bottom 40 %: Text + CTA ───────────── */}
      <View style={styles.textSection}>
        {/* Slide 0 text */}
        <Animated.View
          pointerEvents={currentSlide === 0 ? 'auto' : 'none'}
          style={[styles.textLayer, { opacity: s0Opacity, transform: [{ translateX: s0Tx }] }]}
        >
          <Text style={styles.header}>Position the Camera</Text>
          <Text style={styles.subtext}>
            Prop your phone on a tripod or a water bottle a few feet away from you.
          </Text>
          <TouchableOpacity onPress={handleNext} style={styles.nextButton} activeOpacity={0.6}>
            <Text style={styles.nextText}>{'Next  \u2192'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Slide 1 text */}
        <Animated.View
          pointerEvents={currentSlide === 1 ? 'auto' : 'none'}
          style={[styles.textLayer, styles.textLayerAbsolute, { opacity: s1Opacity, transform: [{ translateX: s1Tx }] }]}
        >
          <Text style={styles.header}>Stay in Frame</Text>
          <Text style={styles.subtext}>
            Make sure your full body is visible on screen during the entire lift.
          </Text>
          <TouchableOpacity onPress={handleNext} style={styles.nextButton} activeOpacity={0.6}>
            <Text style={styles.nextText}>{'Next  \u2192'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Slide 2 text */}
        <Animated.View
          pointerEvents={currentSlide === 2 ? 'auto' : 'none'}
          style={[styles.textLayer, styles.textLayerAbsolute, { opacity: s2Opacity, transform: [{ translateX: s2Tx }] }]}
        >
          <Text style={styles.header}>Tailored Setup</Text>
          <Text style={styles.subtext}>
            Every exercise is different. Tap the '?' icon in the top left anytime to see exactly how to frame your current movement.
          </Text>
          <Animated.View
            style={[
              styles.ctaWrapper,
              { transform: [{ scale: buttonScale }] },
              Platform.OS === 'ios' && {
                shadowColor: COLORS.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: glowOp as any,
                shadowRadius: glowRad as any,
              },
            ]}
          >
            <TouchableOpacity onPress={handleOpenCamera} activeOpacity={0.85}>
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.ctaButton}
              >
                <Text style={styles.ctaText}>Open Camera</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>
    </Animated.View>
  );
};

// ── Styles ──────────────────────────────────────────────────────

const Q_SIZE = 32;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Art section (top 60%) ── */
  artSection: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideLayerAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepLabel: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.primary,
    letterSpacing: 4,
    marginBottom: 28,
  },
  vectorWrap: {},

  /* ── Header hint (slide 2) ── */
  hintWrap: {
    width: 280,
    height: 240,
    overflow: 'visible',
  },
  rippleOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    overflow: 'visible',
  },
  qIcon: {
    position: 'absolute',
    left: HINT_ICON_CX - Q_SIZE / 2,
    top: HINT_ICON_CY - Q_SIZE / 2,
    width: Q_SIZE,
    height: Q_SIZE,
    borderRadius: Q_SIZE / 2,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  qText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.primary,
  },

  /* ── Pagination ── */
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },

  /* ── Text section (bottom 40%) ── */
  textSection: {
    flex: 0.4,
    paddingHorizontal: 40,
  },
  textLayer: {
    alignItems: 'center',
  },
  textLayerAbsolute: {
    position: 'absolute',
    top: 0,
    left: 40,
    right: 40,
    alignItems: 'center',
  },
  header: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 36,
  },

  /* ── Next button ── */
  nextButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  nextText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },

  /* ── CTA button (final slide) ── */
  ctaWrapper: {
    alignSelf: 'stretch',
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
