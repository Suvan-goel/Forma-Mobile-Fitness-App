import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { COLORS, FONTS } from '../constants/theme';

const BARBELL_WIDTH = 220;
const SCAN_DURATION = 800;
const AUTO_NAV_DELAY = 4500;
const PHASE_DURATION = 1500;

const TEXT_PHASES = [
  'Analyzing training inputs...',
  'Mapping biomechanical profile...',
  'Finalizing custom AI blueprint...',
];

// ── Barbell SVG ─────────────────────────────────────────────

const BarbellWireframe: React.FC = () => (
  <Svg width={BARBELL_WIDTH} height={60} viewBox="0 0 220 60">
    {/* Left sleeve */}
    <Rect x={10} y={22} width={30} height={16} rx={3} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} fill="none" />
    {/* Left plate */}
    <Rect x={42} y={10} width={16} height={40} rx={2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} fill="none" />
    {/* Bar */}
    <Rect x={58} y={26} width={104} height={8} rx={4} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} fill="none" />
    {/* Right plate */}
    <Rect x={162} y={10} width={16} height={40} rx={2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} fill="none" />
    {/* Right sleeve */}
    <Rect x={180} y={22} width={30} height={16} rx={3} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} fill="none" />
  </Svg>
);

// ── Main Component ──────────────────────────────────────────

interface OnboardingInterstitialProps {
  onComplete: () => void;
}

export const OnboardingInterstitial: React.FC<OnboardingInterstitialProps> = ({ onComplete }) => {
  const scanX = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0.15)).current;

  const [phaseIndex, setPhaseIndex] = useState(0);

  // ── Text phase rotation ─────────────────────────────────
  useEffect(() => {
    // Fade in the first phrase immediately
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    const interval = setInterval(() => {
      // Fade out current text
      Animated.timing(textOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setPhaseIndex((prev) => {
          const next = prev + 1;
          if (next >= TEXT_PHASES.length) {
            clearInterval(interval);
            return prev;
          }
          return next;
        });
        // Fade in next text
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });

      // Pulse the laser glow brighter on each transition
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.45,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.15,
          duration: 400,
          useNativeDriver: false,
        }),
      ]).start();
    }, PHASE_DURATION);

    return () => clearInterval(interval);
  }, [textOpacity, glowOpacity]);

  // ── Scan + overall fade ─────────────────────────────────
  useEffect(() => {
    // Fade in the whole screen
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Scanning laser — oscillate back and forth
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanX, {
          toValue: 1,
          duration: SCAN_DURATION,
          useNativeDriver: false,
        }),
        Animated.timing(scanX, {
          toValue: 0,
          duration: SCAN_DURATION,
          useNativeDriver: false,
        }),
      ]),
    );
    scanLoop.start();

    // Auto-navigate after 4.5s
    const timer = setTimeout(() => {
      Animated.timing(fadeIn, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        onComplete();
      });
    }, AUTO_NAV_DELAY);

    return () => {
      clearTimeout(timer);
      scanLoop.stop();
    };
  }, [scanX, fadeIn, onComplete]);

  // Map scanX [0,1] → pixel position across barbell
  const scanLineX = scanX.interpolate({
    inputRange: [0, 1],
    outputRange: [10, BARBELL_WIDTH - 10],
  });

  return (
    <Animated.View style={[styles.root, { opacity: fadeIn }]}>
      {/* Center content */}
      <View style={styles.centerContent}>
        {/* Barbell with scan line overlay */}
        <View style={styles.barbellContainer}>
          <BarbellWireframe />
          {/* Scanning violet line */}
          <Animated.View
            style={[
              styles.scanLine,
              { left: scanLineX as any },
            ]}
          >
            <View style={styles.scanLineInner} />
            <Animated.View style={[styles.scanGlow, { opacity: glowOpacity }]} />
          </Animated.View>
        </View>
      </View>

      {/* Bottom text — rotating phases */}
      <View style={styles.bottomText}>
        <Animated.Text style={[styles.loadingText, { opacity: textOpacity }]}>
          {TEXT_PHASES[phaseIndex]}
        </Animated.Text>
      </View>
    </Animated.View>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barbellContainer: {
    width: BARBELL_WIDTH,
    height: 60,
    position: 'relative',
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanLineInner: {
    width: 2,
    height: '100%',
    backgroundColor: COLORS.primary,
  },
  scanGlow: {
    position: 'absolute',
    width: 20,
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  bottomText: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
    width: '100%',
    height: 24,
  },
  loadingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
});
