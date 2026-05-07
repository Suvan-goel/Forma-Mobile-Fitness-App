import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Image,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Rect, G, Ellipse, Defs, RadialGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Check, HelpCircle } from 'lucide-react-native';
import {
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_LG,
  CARD_SHADOW,
  COLORS,
  FONTS,
  SPACING,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

const TOTAL_SLIDES = 3;

// Front-view holographic model asset
const frontImg = require('../../../assets/front-view.png');

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
    <Line x1={130} y1={225} x2={130} y2={200} stroke="rgba(255, 255, 255, 0.055)" strokeWidth={0.8} strokeDasharray="3,3" />
    <Path d="M 130 213 Q 126 207, 123 202" stroke="rgba(139,92,246,0.20)" strokeWidth={0.8} fill="none" />
  </Svg>
);

// ── Viewfinder Brackets + Holographic Front Model (Slide 1) ─────
// Image (front-view.png) aspect ratio ~1:2.50 → at h=210: w=84

const FRAME_W = 260;
const FRAME_H = 280;
const FRAME_IMG = { x: 88, y: 35, w: 84, h: 210 };

const FrameViewVisual: React.FC = () => (
  <View style={{ width: FRAME_W, height: FRAME_H }}>
    {/* Background: violet aura behind figure */}
    <Svg width={FRAME_W} height={FRAME_H} viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="frameGlow" cx="50%" cy="50%" r="35%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.14" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={FRAME_W / 2} cy={FRAME_H / 2}
        rx={FRAME_IMG.w / 2 + 25} ry={FRAME_IMG.h / 2 + 15}
        fill="url(#frameGlow)" />
    </Svg>

    {/* Holographic front-view human model */}
    <View
      style={[
        {
          position: 'absolute',
          left: FRAME_IMG.x,
          top: FRAME_IMG.y,
          width: FRAME_IMG.w,
          height: FRAME_IMG.h,
          overflow: 'visible',
        },
        Platform.OS === 'ios' && {
          shadowColor: COLORS.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 20,
        },
      ]}
    >
      <Image
        source={frontImg}
        style={{ width: FRAME_IMG.w, height: FRAME_IMG.h, opacity: 0.82 }}
        resizeMode="contain"
      />
      {/* Cold violet tint overlay */}
      <View style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: COLORS.primary,
        opacity: 0.03,
      }} />
    </View>

    {/* Foreground: viewfinder brackets + corner dots */}
    <Svg width={FRAME_W} height={FRAME_H} viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
      style={StyleSheet.absoluteFill}>
      {/* Corner brackets */}
      <Path d="M 63 32 L 35 32 L 35 78"
        stroke={COLORS.primary} strokeWidth={2.5} fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M 197 32 L 225 32 L 225 78"
        stroke={COLORS.primary} strokeWidth={2.5} fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M 63 258 L 35 258 L 35 212"
        stroke={COLORS.primary} strokeWidth={2.5} fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M 197 258 L 225 258 L 225 212"
        stroke={COLORS.primary} strokeWidth={2.5} fill="none"
        strokeLinecap="round" strokeLinejoin="round" />

      {/* Corner accent dots */}
      <Circle cx={35} cy={32} r={3} fill={COLORS.primary} opacity={0.45} />
      <Circle cx={225} cy={32} r={3} fill={COLORS.primary} opacity={0.45} />
      <Circle cx={35} cy={258} r={3} fill={COLORS.primary} opacity={0.45} />
      <Circle cx={225} cy={258} r={3} fill={COLORS.primary} opacity={0.45} />
    </Svg>
  </View>
);

// ── SVG: Dimmed Camera Screen Wireframe (Slide 2) ──────────────
// The glowing ? icon + ripple rings are overlaid as Animated.Views

const HINT_ICON_CX = 58;
const HINT_ICON_CY = 55;

const HeaderHintVector: React.FC = () => (
  <Svg width={280} height={240} viewBox="0 0 280 240">
    {/* Phone frame (top portion) */}
    <Rect x={18} y={8} width={244} height={224} rx={24}
      stroke="rgba(255, 255, 255, 0.04)" strokeWidth={1.2} fill="rgba(255,255,255,0.015)" />

    {/* Status bar hints */}
    <Rect x={38} y={22} width={24} height={5} rx={2.5} fill="rgba(255, 255, 255, 0.055)" />
    <Rect x={218} y={22} width={14} height={5} rx={2} stroke="rgba(255, 255, 255, 0.04)" strokeWidth={0.7} fill="none" />

    {/* Header bar fill */}
    <Rect x={18} y={36} width={244} height={38} fill="rgba(255, 255, 255, 0.022)" />

    {/* Header separator */}
    <Line x1={28} y1={74} x2={252} y2={74} stroke="rgba(255, 255, 255, 0.04)" strokeWidth={0.5} />

    {/* ? icon placeholder (dimmed circle — the real one is an overlay) */}
    <Circle cx={HINT_ICON_CX} cy={HINT_ICON_CY} r={15}
      stroke="rgba(255, 255, 255, 0.04)" strokeWidth={0.8} fill="none" />

    {/* Exercise title placeholder */}
    <Rect x={108} y={49} width={64} height={11} rx={4} fill="rgba(255, 255, 255, 0.04)" />

    {/* Right-side icon placeholder */}
    <Circle cx={234} cy={52} r={1.5} fill="rgba(255, 255, 255, 0.04)" />
    <Circle cx={234} cy={58} r={1.5} fill="rgba(255, 255, 255, 0.04)" />

    {/* Camera content area — faint viewfinder brackets */}
    <Path d="M 55 95 L 38 95 L 38 115" stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />
    <Path d="M 225 95 L 242 95 L 242 115" stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />
    <Path d="M 55 195 L 38 195 L 38 175" stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />
    <Path d="M 225 195 L 242 195 L 242 175" stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} fill="none" strokeLinecap="round" />

    {/* Center crosshair */}
    <Line x1={131} y1={145} x2={149} y2={145} stroke="rgba(255, 255, 255, 0.03)" strokeWidth={0.8} />
    <Line x1={140} y1={136} x2={140} y2={154} stroke="rgba(255, 255, 255, 0.03)" strokeWidth={0.8} />

    {/* Bottom controls hint */}
    <Line x1={28} y1={210} x2={252} y2={210} stroke="rgba(255, 255, 255, 0.03)" strokeWidth={0.5} />
    <Circle cx={140} cy={224} r={8} stroke="rgba(255, 255, 255, 0.055)" strokeWidth={1} fill="none" />
  </Svg>
);

// ── Main Component ──────────────────────────────────────────────

interface CameraSetupGuideProps {
  onComplete: () => void;
}

export const CameraSetupGuide: React.FC<CameraSetupGuideProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [currentSlide, setCurrentSlide] = useState(0);
  const isCompactHeight = height < 720;
  const horizontalPadding = Math.max(SPACING.screenHorizontal, Math.min(26, width * 0.055));
  const artStageHeight = isCompactHeight ? 310 : 360;

  // Animation values
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;       // 0 → 1 → 2 (native driver: opacity + transform)
  const dotAnim = useRef(new Animated.Value(0)).current;         // 0 → 1 → 2 (JS driver: width)
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
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: next,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(dotAnim, {
        toValue: next,
        duration: 400,
        useNativeDriver: false,
      }),
    ]).start();
  }, [currentSlide, slideAnim, dotAnim]);

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

  // Pagination dots (3) — driven by dotAnim (JS driver) because width is a layout property
  const dot0W = dotAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [20, 6, 6] });
  const dot0Op = dotAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 0.3, 0.3] });
  const dot1W = dotAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [6, 20, 6] });
  const dot1Op = dotAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 0.3] });
  const dot2W = dotAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [6, 6, 20] });
  const dot2Op = dotAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 0.3, 1] });

  // CTA glow
  const glowOp = buttonGlow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
  const glowRad = buttonGlow.interpolate({ inputRange: [0, 1], outputRange: [12, 25] });
  const isFinalSlide = currentSlide === TOTAL_SLIDES - 1;

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
    <ScreenBackground style={styles.root}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeIn,
            paddingTop: insets.top + 12,
            paddingBottom: getBottomOverlayPadding(insets.bottom, 34),
            paddingHorizontal: horizontalPadding,
          },
        ]}
      >
        <View style={styles.topBar}>
          <View style={styles.titleBlock}>
            <Text style={styles.kicker}>CAMERA SETUP</Text>
            <Text style={styles.topTitle}>Frame every rep cleanly</Text>
          </View>
          <View style={styles.counterPill}>
            <Text style={styles.counterText}>{currentSlide + 1}/{TOTAL_SLIDES}</Text>
          </View>
        </View>

        <LinearGradient
          colors={[...CARD_GRADIENT_COLORS]}
          start={CARD_GRADIENT_START}
          end={CARD_GRADIENT_END}
          style={[styles.artCard, { height: artStageHeight }]}
        >
          <View style={styles.artCardEdge}>
            <View style={styles.artHeaderRow}>
              <View style={styles.artIconBubble}>
                <HelpCircle size={16} color={COLORS.accent} strokeWidth={1.7} />
              </View>
              <Text style={styles.stepLabel}>
                {currentSlide === 0 ? 'STABLE BASE' : currentSlide === 1 ? 'FULL BODY FRAME' : 'EXERCISE-SPECIFIC HELP'}
              </Text>
            </View>

            <View style={styles.artStage}>
              <Animated.View style={[styles.slideLayer, { opacity: s0Opacity, transform: [{ translateX: s0Tx }] }]}>
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

              <Animated.View style={[styles.slideLayer, { opacity: s1Opacity, transform: [{ translateX: s1Tx }] }]}>
                <Animated.View style={[styles.vectorWrap, { transform: [{ scale: bracketPulse }] }]}>
                  <FrameViewVisual />
                </Animated.View>
              </Animated.View>

              <Animated.View style={[styles.slideLayer, { opacity: s2Opacity, transform: [{ translateX: s2Tx }] }]}>
                <View style={styles.hintWrap}>
                  <HeaderHintVector />
                  <View style={styles.rippleOverlay} pointerEvents="none">
                    {ripples.map((anim, i) => (
                      <Animated.View key={i} style={rippleRingStyle(anim)} />
                    ))}
                    <View style={styles.qIcon}>
                      <Text style={styles.qText}>?</Text>
                    </View>
                  </View>
                </View>
              </Animated.View>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.paginationRow}>
          <Animated.View style={[styles.dot, { width: dot0W, opacity: dot0Op, backgroundColor: COLORS.primary }]} />
          <Animated.View style={[styles.dot, { width: dot1W, opacity: dot1Op, backgroundColor: COLORS.primary }]} />
          <Animated.View style={[styles.dot, { width: dot2W, opacity: dot2Op, backgroundColor: COLORS.primary }]} />
        </View>

        <View style={[styles.textStage, isCompactHeight && styles.textStageCompact]}>
          <Animated.View
            pointerEvents={currentSlide === 0 ? 'auto' : 'none'}
            style={[styles.textLayer, { opacity: s0Opacity, transform: [{ translateX: s0Tx }] }]}
          >
            <Text style={styles.header}>Position the Camera</Text>
            <Text style={styles.subtext}>
              Set your phone on a stable surface a few feet away, with the lens around hip to chest height.
            </Text>
          </Animated.View>

          <Animated.View
            pointerEvents={currentSlide === 1 ? 'auto' : 'none'}
            style={[styles.textLayer, { opacity: s1Opacity, transform: [{ translateX: s1Tx }] }]}
          >
            <Text style={styles.header}>Stay in Frame</Text>
            <Text style={styles.subtext}>
              Keep your full body visible through each rep so Forma can track joints without losing context.
            </Text>
          </Animated.View>

          <Animated.View
            pointerEvents={currentSlide === 2 ? 'auto' : 'none'}
            style={[styles.textLayer, { opacity: s2Opacity, transform: [{ translateX: s2Tx }] }]}
          >
            <Text style={styles.header}>Use the Setup Guide</Text>
            <Text style={styles.subtext}>
              Tap the help icon in the camera header for exercise-specific framing before you record.
            </Text>
          </Animated.View>
        </View>

        <Animated.View
          style={[
            styles.ctaWrapper,
            Platform.OS === 'ios' && isFinalSlide && {
              shadowColor: COLORS.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: glowOp as any,
              shadowRadius: glowRad as any,
            },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <TouchableOpacity onPress={isFinalSlide ? handleOpenCamera : handleNext} activeOpacity={0.86}>
              <LinearGradient
                colors={isFinalSlide ? [COLORS.primary, COLORS.primaryDark] : ['rgba(255,255,255,0.065)', 'rgba(255,255,255,0.035)']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.ctaButton, !isFinalSlide && styles.secondaryButton]}
              >
                <Text style={[styles.ctaText, !isFinalSlide && styles.secondaryButtonText]}>
                  {isFinalSlide ? 'Start Recording' : 'Next'}
                </Text>
                {isFinalSlide ? (
                  <Check size={18} color="#FFFFFF" strokeWidth={2} />
                ) : (
                  <ArrowRight size={18} color={COLORS.text} strokeWidth={2} />
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </ScreenBackground>
  );
};

// ── Styles ──────────────────────────────────────────────────────

const Q_SIZE = 32;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  titleBlock: {
    flex: 1,
    gap: 5,
  },
  kicker: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.accent,
    letterSpacing: 1.8,
  },
  topTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
    letterSpacing: 0,
  },
  counterPill: {
    height: 34,
    minWidth: 54,
    paddingHorizontal: 12,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  counterText: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    color: COLORS.textSecondary,
  },

  /* Art card */
  artCard: {
    borderRadius: CARD_RADIUS_LG,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  artCardEdge: {
    flex: 1,
    borderRadius: CARD_RADIUS_LG,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderTopColor: COLORS.borderStrong,
    overflow: 'hidden',
  },
  artHeaderRow: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  artIconBubble: {
    width: 30,
    height: 30,
    borderRadius: CARD_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.28)',
  },
  artStage: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideLayer: {
    position: 'absolute',
    top: 30,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1.3,
  },
  vectorWrap: {},

  /* Header hint (slide 2) */
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

  /* Pagination */
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 2,
    paddingBottom: 2,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },

  /* Text */
  textStage: {
    minHeight: 150,
    position: 'relative',
  },
  textStageCompact: {
    minHeight: 128,
  },
  textLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  header: {
    fontFamily: FONTS.display.bold,
    fontSize: 27,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: 0,
    marginBottom: 10,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 330,
  },

  /* CTA */
  ctaWrapper: {
    marginTop: 'auto',
    marginBottom: 16,
    borderRadius: CARD_RADIUS,
    overflow: 'visible',
  },
  ctaButton: {
    height: 56,
    borderRadius: CARD_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  secondaryButton: {
    borderColor: COLORS.borderStrong,
  },
  ctaText: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  secondaryButtonText: {
    color: COLORS.text,
  },
});
