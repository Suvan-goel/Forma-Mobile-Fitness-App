import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Text, Platform } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CheckCircle } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const BARBELL_WIDTH = 240;
const SCAN_LEFT = 10;
const SCAN_RIGHT = BARBELL_WIDTH - 10;
const SCAN_DURATION = 750;
const PHASE_DURATION = 1500;

const TEXT_PHASES = [
  'Analyzing training inputs...',
  'Mapping biomechanical profile...',
  'Finalizing custom AI blueprint...',
];

// ── Barbell SVG ─────────────────────────────────────────────

const BarbellWireframe: React.FC = () => (
  <Svg width={BARBELL_WIDTH} height={64} viewBox="0 0 240 64">
    {/* Left collar */}
    <Rect x={10} y={24} width={32} height={16} rx={3} stroke="#E4E4E7" strokeWidth={2.5} fill="none" />
    {/* Left plate */}
    <Rect x={44} y={8} width={18} height={48} rx={2} stroke="#FFFFFF" strokeWidth={2.5} fill="none" />
    {/* Bar */}
    <Rect x={62} y={28} width={116} height={8} rx={4} stroke="#E4E4E7" strokeWidth={2.5} fill="none" />
    {/* Right plate */}
    <Rect x={178} y={8} width={18} height={48} rx={2} stroke="#FFFFFF" strokeWidth={2.5} fill="none" />
    {/* Right collar */}
    <Rect x={198} y={24} width={32} height={16} rx={3} stroke="#E4E4E7" strokeWidth={2.5} fill="none" />
  </Svg>
);

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
  const successScale   = useRef(new Animated.Value(0.8)).current;
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

    // Phase 1 → 2 text cycles
    const t1 = setTimeout(() => cycleText(1), PHASE_DURATION);
    const t2 = setTimeout(() => cycleText(2), PHASE_DURATION * 2);

    // Completion — cancel scan (no .stop() on the loop) then cross-fade
    const t3 = setTimeout(() => {
      scanCancelledRef.current = true; // current pass finishes naturally, recursion stops

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
      if (scanAnimRef.current) scanAnimRef.current.stop(); // safe: component is unmounting
    };
  }, [scanX, screenFade, textOpacity, loadingOpacity, successOpacity, successScale, buttonOpacity, cycleText, runScanPass]);

  return (
    <Animated.View style={[styles.root, { opacity: screenFade }]}>

      {/* ── Center area: loading and success overlap ───────── */}
      <View style={styles.centerArea}>

        {/* Loading group — fades out when scan completes */}
        <Animated.View style={[styles.loadingGroup, { opacity: loadingOpacity }]}>
          <View style={styles.barbellContainer}>
            <BarbellWireframe />
            <Animated.View style={[styles.scanLine, { transform: [{ translateX: scanX }] }]}>
              <View style={styles.scanGlow} />
              <View style={styles.scanCore} />
            </Animated.View>
          </View>
          <Animated.Text style={[styles.loadingText, { opacity: textOpacity }]}>
            {TEXT_PHASES[phaseIndex]}
          </Animated.Text>
        </Animated.View>

        {/* Success state — fades + springs in over the same space */}
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
          {/* Outer glow ring */}
          <View style={styles.iconOuterRing}>
            {/* Inner glow circle */}
            <View style={styles.iconInnerCircle}>
              <CheckCircle
                size={52}
                color="#8B5CF6"
                strokeWidth={1.5}
              />
            </View>
          </View>

          <View style={styles.successTextGroup}>
            <Text style={styles.successHeader}>Analysis Complete.</Text>
            <Text style={styles.successSubtext}>Your custom beta profile is ready.</Text>
          </View>
        </Animated.View>

      </View>

      {/* ── CTA button — fades in with success state ────────── */}
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
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Finalize Profile</Text>
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

  /* ── Loading group ──────────────────────── */
  loadingGroup: {
    alignItems: 'center',
    gap: 32,
  },
  barbellContainer: {
    width: BARBELL_WIDTH,
    height: 64,
    position: 'relative',
    overflow: 'visible',
  },

  /* ── Laser scan line ────────────────────── */
  scanLine: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    left: 0,
    width: 3,
    alignItems: 'center',
  },
  scanCore: {
    width: 3,
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 1.5,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.8,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
      },
      android: { elevation: 5 },
    }),
  },
  scanGlow: {
    position: 'absolute',
    width: 22,
    height: '100%',
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    borderRadius: 11,
  },

  /* ── Cycling text ───────────────────────── */
  loadingText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  /* ── Success state ──────────────────────── */
  successContainer: {
    position: 'absolute',
    alignItems: 'center',
    gap: 28,
  },
  iconOuterRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.35,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 0 },
      },
      android: { elevation: 6 },
    }),
  },
  iconInnerCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.6,
        shadowRadius: 15,
        shadowOffset: { width: 0, height: 0 },
      },
      android: { elevation: 4 },
    }),
  },
  successTextGroup: {
    alignItems: 'center',
    gap: 10,
  },
  successHeader: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  successSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: '#A1A1AA',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  /* ── CTA button ─────────────────────────── */
  ctaContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  ctaButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 18,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOpacity: 0.5,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 12 },
    }),
  },
  ctaText: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
