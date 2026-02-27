import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Text, Platform } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const BARBELL_WIDTH = 260;
const BARBELL_HEIGHT = 80;
const SCAN_LEFT = 5;
const SCAN_RIGHT = BARBELL_WIDTH - 5;
const SCAN_DURATION = 800;
const PHASE_DURATION = 1500;

const TEXT_PHASES = [
  'Analyzing training inputs...',
  'Mapping biomechanical profile...',
  'Finalizing custom AI blueprint...',
];

// ── Barbell SVG ─────────────────────────────────────────────

const BarbellWireframe: React.FC = () => (
  <Svg width={BARBELL_WIDTH} height={BARBELL_HEIGHT} viewBox={`0 0 ${BARBELL_WIDTH} ${BARBELL_HEIGHT}`}>
    {/* Left collar */}
    <Rect x={8} y={30} width={26} height={20} rx={3} stroke="#D4D4D8" strokeWidth={2} fill="none" />

    {/* Left plate outer */}
    <Rect x={34} y={8} width={20} height={64} rx={3} stroke="#FFFFFF" strokeWidth={2.5} fill="none" />
    {/* Left plate inner detail ring */}
    <Rect x={38} y={16} width={12} height={48} rx={2} stroke="rgba(255,255,255,0.22)" strokeWidth={1} fill="none" />

    {/* Left grip section */}
    <Rect x={54} y={32} width={32} height={16} rx={3} stroke="#C4C4C8" strokeWidth={1.5} fill="none" />

    {/* Center knurled section */}
    <Rect x={86} y={32} width={88} height={16} rx={2} stroke="#C4C4C8" strokeWidth={1.5} fill="none" />

    {/* Knurling marks — 8 vertical bars across center */}
    {Array.from({ length: 8 }, (_, i) => (
      <Rect
        key={i}
        x={92 + i * 11}
        y={36}
        width={1.5}
        height={8}
        rx={0.75}
        fill="rgba(255,255,255,0.28)"
      />
    ))}

    {/* Right grip section */}
    <Rect x={174} y={32} width={32} height={16} rx={3} stroke="#C4C4C8" strokeWidth={1.5} fill="none" />

    {/* Right plate inner detail ring */}
    <Rect x={210} y={16} width={12} height={48} rx={2} stroke="rgba(255,255,255,0.22)" strokeWidth={1} fill="none" />
    {/* Right plate outer */}
    <Rect x={206} y={8} width={20} height={64} rx={3} stroke="#FFFFFF" strokeWidth={2.5} fill="none" />

    {/* Right collar */}
    <Rect x={226} y={30} width={26} height={20} rx={3} stroke="#D4D4D8" strokeWidth={2} fill="none" />
  </Svg>
);

// ── Phase Dots ──────────────────────────────────────────────

const PhaseDots: React.FC<{ phase: number }> = ({ phase }) => (
  <View style={phaseStyles.row}>
    {TEXT_PHASES.map((_, i) => (
      <View
        key={i}
        style={[
          phaseStyles.dot,
          i < phase ? phaseStyles.dotComplete : i === phase ? phaseStyles.dotActive : phaseStyles.dotUpcoming,
        ]}
      />
    ))}
  </View>
);

const phaseStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 3,
    borderRadius: 1.5,
  },
  dotComplete: {
    width: 8,
    backgroundColor: COLORS.primary,
    opacity: 0.55,
  },
  dotActive: {
    width: 28,
    backgroundColor: COLORS.primary,
  },
  dotUpcoming: {
    width: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});

// ── Main Component ──────────────────────────────────────────

interface OnboardingInterstitialProps {
  onComplete: () => void;
}

export const OnboardingInterstitial: React.FC<OnboardingInterstitialProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();

  // Animated values
  const scanX          = useRef(new Animated.Value(SCAN_LEFT)).current;
  const screenFade     = useRef(new Animated.Value(0)).current;
  const textOpacity    = useRef(new Animated.Value(0)).current;
  const loadingOpacity = useRef(new Animated.Value(1)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale   = useRef(new Animated.Value(0.85)).current;
  const buttonOpacity  = useRef(new Animated.Value(0)).current;

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  // Recursive scan approach — avoids Animated.loop.stop() which internally
  // spawns a JS-driver cleanup animation that conflicts with native-driver nodes.
  const scanCancelledRef = useRef(false);
  const scanAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // ── Haptic on success reveal ─────────────────────────────
  useEffect(() => {
    if (isComplete) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [isComplete]);

  // ── Text cycle helper ────────────────────────────────────
  const cycleText = useCallback(
    (nextIndex: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.timing(textOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setPhaseIndex(nextIndex);
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    },
    [textOpacity],
  );

  // ── Recursive scan (safe alternative to Animated.loop) ───
  const runScanPass = useCallback(() => {
    if (scanCancelledRef.current) return;
    const anim = Animated.sequence([
      Animated.timing(scanX, { toValue: SCAN_RIGHT, duration: SCAN_DURATION, useNativeDriver: true }),
      Animated.timing(scanX, { toValue: SCAN_LEFT,  duration: SCAN_DURATION, useNativeDriver: true }),
    ]);
    scanAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && !scanCancelledRef.current) runScanPass();
    });
  }, [scanX]);

  // ── Main sequence ────────────────────────────────────────
  useEffect(() => {
    scanCancelledRef.current = false;

    // Screen + text fade in
    Animated.timing(screenFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    // Kick off recursive scan
    runScanPass();

    // Phase text cycles
    const t1 = setTimeout(() => cycleText(1), PHASE_DURATION);
    const t2 = setTimeout(() => cycleText(2), PHASE_DURATION * 2);

    // Completion — cancel scan then cross-fade to success state
    const t3 = setTimeout(() => {
      scanCancelledRef.current = true;

      Animated.parallel([
        Animated.timing(loadingOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(successOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(successScale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
        Animated.timing(buttonOpacity,  { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start(() => setIsComplete(true));
    }, PHASE_DURATION * 3);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      scanCancelledRef.current = true;
      if (scanAnimRef.current) scanAnimRef.current.stop();
    };
  }, [scanX, screenFade, textOpacity, loadingOpacity, successOpacity, successScale, buttonOpacity, cycleText, runScanPass]);

  return (
    <Animated.View style={[styles.root, { opacity: screenFade }]}>

      {/* ── Loading group — full-screen absolute overlay, always centered ── */}
      <Animated.View style={[styles.loadingOverlay, { opacity: loadingOpacity }]} pointerEvents="none">
        <View style={styles.loadingGroup}>

          {/* Label */}
          <View style={styles.labelRow}>
            <View style={styles.labelLine} />
            <Text style={styles.labelText}>PROFILE ANALYSIS</Text>
            <View style={styles.labelLine} />
          </View>

          {/* Barbell with corner brackets */}
          <View style={styles.barbellWrapper}>
            {/* Subtle ambient glow behind barbell */}
            <View style={styles.barbellGlow} />

            {/* Corner brackets — precision targeting feel */}
            <View style={[styles.cornerBracket, styles.cornerTL]} />
            <View style={[styles.cornerBracket, styles.cornerTR]} />
            <View style={[styles.cornerBracket, styles.cornerBL]} />
            <View style={[styles.cornerBracket, styles.cornerBR]} />

            {/* Barbell + laser scan */}
            <View style={styles.barbellContainer}>
              <BarbellWireframe />
              <Animated.View style={[styles.scanLine, { transform: [{ translateX: scanX }] }]}>
                <View style={styles.scanGlow} />
                <View style={styles.scanCore} />
              </Animated.View>
            </View>
          </View>

          {/* Phase progress dots */}
          <PhaseDots phase={phaseIndex} />

          {/* Cycling status text */}
          <Animated.Text style={[styles.loadingText, { opacity: textOpacity }]}>
            {TEXT_PHASES[phaseIndex]}
          </Animated.Text>

        </View>
      </Animated.View>

      {/* ── Center area — only used to anchor success state position ── */}
      <View style={styles.centerArea}>

        {/* Success state */}
        <Animated.View
          style={[
            styles.successContainer,
            {
              opacity: successOpacity,
              transform: [{ scale: successScale }],
            },
          ]}
          pointerEvents="none"
        >
          {/* Label */}
          <View style={styles.labelRow}>
            <View style={styles.labelLine} />
            <Text style={styles.labelText}>ANALYSIS COMPLETE</Text>
            <View style={styles.labelLine} />
          </View>

          {/* Hero headline */}
          <Text style={styles.successHeader}>
            Profile Ready<Text style={styles.accentDot}>.</Text>
          </Text>

          {/* Subtext */}
          <Text style={styles.successSubtext}>Your custom AI blueprint has been built.</Text>

          {/* Metrics readout card */}
          <View style={styles.metricsCard}>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>AI Blueprint</Text>
              <View style={styles.metricStatus}>
                <View style={styles.metricDot} />
                <Text style={styles.metricValue}>Compiled</Text>
              </View>
            </View>
            <View style={styles.metricSeparator} />
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Form Profile</Text>
              <View style={styles.metricStatus}>
                <View style={styles.metricDot} />
                <Text style={styles.metricValue}>Ready</Text>
              </View>
            </View>
            <View style={styles.metricSeparator} />
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Coach Mode</Text>
              <View style={styles.metricStatus}>
                <View style={styles.metricDot} />
                <Text style={styles.metricValue}>Active</Text>
              </View>
            </View>
          </View>
        </Animated.View>

      </View>

      {/* ── CTA button — fades in with success state ─────────── */}
      <Animated.View
        style={[
          styles.ctaContainer,
          {
            opacity: buttonOpacity,
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
        pointerEvents={isComplete ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={onComplete}
          activeOpacity={0.7}
        >
          <Text style={styles.ctaText}>Begin Training</Text>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>
      </Animated.View>

    </Animated.View>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Center area (loading + success share this space) ─── */
  centerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Loading overlay — full-screen, always centered ─── */
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Loading group ──────────────────────── */
  loadingGroup: {
    alignItems: 'center',
    gap: 28,
  },

  /* ── Label row ───────────────────────────── */
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  labelLine: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(139, 92, 246, 0.35)',
  },
  labelText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.primary,
    letterSpacing: 2.5,
  },

  /* ── Barbell wrapper (contains brackets + glow) ─────── */
  barbellWrapper: {
    width: BARBELL_WIDTH + 48,
    height: BARBELL_HEIGHT + 48,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Ambient glow behind barbell ─────────────────────── */
  barbellGlow: {
    position: 'absolute',
    width: BARBELL_WIDTH + 20,
    height: BARBELL_HEIGHT + 60,
    borderRadius: 80,
    backgroundColor: 'rgba(139, 92, 246, 0.03)',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.13,
        shadowRadius: 48,
        shadowOffset: { width: 0, height: 0 },
      },
    }),
  },

  /* ── Corner brackets ─────────────────────── */
  cornerBracket: {
    position: 'absolute',
    width: 16,
    height: 16,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderTopColor: 'rgba(139, 92, 246, 0.5)',
    borderLeftColor: 'rgba(139, 92, 246, 0.5)',
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
    borderTopColor: 'rgba(139, 92, 246, 0.5)',
    borderRightColor: 'rgba(139, 92, 246, 0.5)',
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 1.5,
    borderLeftWidth: 1.5,
    borderBottomColor: 'rgba(139, 92, 246, 0.5)',
    borderLeftColor: 'rgba(139, 92, 246, 0.5)',
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomColor: 'rgba(139, 92, 246, 0.5)',
    borderRightColor: 'rgba(139, 92, 246, 0.5)',
  },

  /* ── Barbell container ───────────────────── */
  barbellContainer: {
    width: BARBELL_WIDTH,
    height: BARBELL_HEIGHT,
    position: 'relative',
    overflow: 'visible',
  },

  /* ── Laser scan line ────────────────────── */
  scanLine: {
    position: 'absolute',
    top: -12,
    bottom: -12,
    left: 0,
    width: 3,
    alignItems: 'center',
  },
  scanCore: {
    width: 2,
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.9,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
      },
      android: { elevation: 5 },
    }),
  },
  scanGlow: {
    position: 'absolute',
    width: 32,
    height: '100%',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 16,
  },

  /* ── Cycling status text ─────────────────── */
  loadingText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  /* ── Success state ───────────────────────── */
  successContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 100,
    alignItems: 'center',
    gap: 20,
  },
  accentDot: {
    color: COLORS.primary,
  },
  successHeader: {
    fontFamily: FONTS.display.bold,
    fontSize: 52,
    color: '#FFFFFF',
    letterSpacing: -2,
    textAlign: 'center',
  },
  successSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.2,
    textAlign: 'center',
  },

  /* ── Metrics card ────────────────────────── */
  metricsCard: {
    alignSelf: 'stretch',
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
  },
  metricLabel: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.3,
  },
  metricStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  metricDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.9,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 0 },
      },
    }),
  },
  metricValue: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.primary,
    letterSpacing: 0.3,
  },
  metricSeparator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  /* ── CTA button ──────────────────────────── */
  ctaContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: 180,
  },
  ctaButton: {
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    backgroundColor: 'rgba(139, 92, 246, 0.07)',
  },
  ctaText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  ctaArrow: {
    fontFamily: FONTS.display.medium,
    fontSize: 16,
    color: COLORS.primary,
  },
});
