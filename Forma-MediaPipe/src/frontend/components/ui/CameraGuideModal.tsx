import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  Platform,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Path,
  Circle,
  Line,
  Rect,
  G,
  Ellipse,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.72;

// ─────────────────────────────────────────────────────────────────────────────
// Visual stage constants
// ─────────────────────────────────────────────────────────────────────────────

const VIS_W = 280;
const VIS_H = 220;
const FLOOR_Y = 200;

// Image sources (loaded once at module level)
const sideImg = require('../../../../assets/side-view.png');
const frontImg = require('../../../../assets/front-view.png');

// Side view: image rect + joint reticle targets (SVG coords)
// Source image faces LEFT; we flip it to face RIGHT toward the phone.
// Image aspect ratio ~1:2.94 → at h=205: w=70
const SIDE = {
  img: { x: 75, y: 5, w: 70, h: 195 },
  shoulder: { x: 112, y: 46 },
  hip:      { x: 110, y: 100 },
  ankle:    { x: 108, y: 174 },
  phoneLens: { x: 215, y: 157 },   // visual lens pos after phone rotation
  phoneOrigin: '222, 178',
};

// Front view: image rect + shoulder targets (SVG coords)
// Image aspect ratio ~1:2.50 → at h=205: w=82
const FRONT = {
  img: { x: 99, y: 5, w: 82, h: 195 },
  lShoulder: { x: 115, y: 46 },
  rShoulder: { x: 165, y: 46 },
  phoneLens: { x: 140, y: 207 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface CameraGuideModalProps {
  visible: boolean;
  exerciseName: string;
  viewType: 'SIDE' | 'FRONT' | 'ANY';
  keySetup: string;
  reasonText: string;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG micro-components
// ─────────────────────────────────────────────────────────────────────────────

/** Holographic crosshair reticle projected onto a joint */
const Reticle: React.FC<{ cx: number; cy: number; r?: number }> = ({
  cx, cy, r = 8,
}) => (
  <G>
    {/* Outer glow rings */}
    <Circle cx={cx} cy={cy} r={r + 6} fill={COLORS.primary} opacity={0.05} />
    <Circle cx={cx} cy={cy} r={r + 3} fill={COLORS.primary} opacity={0.08} />
    {/* Target ring */}
    <Circle cx={cx} cy={cy} r={r}
      stroke={COLORS.primary} strokeWidth={1} fill="none" opacity={0.55} />
    {/* Cross arms extending beyond ring */}
    <Line x1={cx - r - 4} y1={cy} x2={cx - r * 0.4} y2={cy}
      stroke={COLORS.primary} strokeWidth={0.8} opacity={0.65} strokeLinecap="round" />
    <Line x1={cx + r * 0.4} y1={cy} x2={cx + r + 4} y2={cy}
      stroke={COLORS.primary} strokeWidth={0.8} opacity={0.65} strokeLinecap="round" />
    <Line x1={cx} y1={cy - r - 4} x2={cx} y2={cy - r * 0.4}
      stroke={COLORS.primary} strokeWidth={0.8} opacity={0.65} strokeLinecap="round" />
    <Line x1={cx} y1={cy + r * 0.4} x2={cx} y2={cy + r + 4}
      stroke={COLORS.primary} strokeWidth={0.8} opacity={0.65} strokeLinecap="round" />
    {/* Center dot */}
    <Circle cx={cx} cy={cy} r={1.5} fill={COLORS.primary} opacity={0.85} />
  </G>
);

/** Focused laser sightline with layered glow aura */
const LaserSight: React.FC<{
  x1: number; y1: number; x2: number; y2: number;
  dashed?: boolean; coreOpacity?: number;
}> = ({ x1, y1, x2, y2, dashed, coreOpacity = 0.5 }) => (
  <G>
    {/* Wide soft glow */}
    <Line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={COLORS.primary} strokeWidth={6} opacity={0.04} strokeLinecap="round" />
    {/* Medium glow */}
    <Line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={COLORS.primary} strokeWidth={2.5} opacity={0.1} strokeLinecap="round" />
    {/* Core beam */}
    <Line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={COLORS.primary} strokeWidth={1.2} opacity={coreOpacity}
      strokeLinecap="round" strokeDasharray={dashed ? '6,4' : undefined} />
  </G>
);

// ─────────────────────────────────────────────────────────────────────────────
// Holographic figure — image + violet rim glow + cold tint overlay
// ─────────────────────────────────────────────────────────────────────────────

const HolographicFigure: React.FC<{
  source: any; x: number; y: number; w: number; h: number; flip?: boolean;
}> = ({ source, x, y, w, h, flip }) => (
  <View
    style={[
      {
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
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
      source={source}
      style={[
        { width: w, height: h, opacity: 0.82 },
        flip ? { transform: [{ scaleX: -1 }] } : undefined,
      ]}
      resizeMode="contain"
    />
    {/* Cold violet tint overlay */}
    <View style={{
      ...StyleSheet.absoluteFillObject,
      backgroundColor: COLORS.primary,
      opacity: 0.03,
    }} />
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// SIDE VIEW — Holographic side-profile + laser sightlines + joint reticles
// + holographic floor grid
// ─────────────────────────────────────────────────────────────────────────────

const SideViewVisual: React.FC = () => (
  <View style={vizStyles.container}>
    {/* ── Background SVG: violet aura + holographic floor grid ── */}
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="sGlow" cx="40%" cy="48%" r="35%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.12" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Violet aura behind figure position */}
      <Ellipse
        cx={SIDE.img.x + SIDE.img.w / 2}
        cy={SIDE.img.y + SIDE.img.h / 2}
        rx={SIDE.img.w / 2 + 20}
        ry={SIDE.img.h / 2 + 10}
        fill="url(#sGlow)"
      />

      {/* Holographic floor grid — horizontal lines with perspective spacing */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Line key={`sh${i}`}
          x1={15} y1={FLOOR_Y - i * (4 + i * 0.5)}
          x2={VIS_W - 15} y2={FLOOR_Y - i * (4 + i * 0.5)}
          stroke={COLORS.primary} strokeWidth={0.5}
          opacity={0.12 - i * 0.016} />
      ))}
      {/* Perspective depth lines converging to vanishing point */}
      {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(i => (
        <Line key={`sv${i}`}
          x1={VIS_W / 2 + i * 20} y1={178}
          x2={VIS_W / 2 + i * 28} y2={FLOOR_Y}
          stroke={COLORS.primary} strokeWidth={0.4}
          opacity={0.06} />
      ))}

      {/* Floor base line */}
      <Line x1={15} y1={FLOOR_Y} x2={VIS_W - 15} y2={FLOOR_Y}
        stroke={COLORS.primary} strokeWidth={0.6} opacity={0.25} />
      <Line x1={15} y1={FLOOR_Y} x2={VIS_W - 15} y2={FLOOR_Y}
        stroke="#404040" strokeWidth={0.4} />
    </Svg>

    {/* ── Holographic human figure (flipped to face RIGHT toward phone) ── */}
    <HolographicFigure
      source={sideImg}
      x={SIDE.img.x} y={SIDE.img.y} w={SIDE.img.w} h={SIDE.img.h}
      flip
    />

    {/* ── Foreground SVG: laser sightlines, joint reticles, phone ── */}
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>

      {/* Laser sightlines: phone lens → shoulder, hip, ankle */}
      <LaserSight
        x1={SIDE.phoneLens.x} y1={SIDE.phoneLens.y}
        x2={SIDE.shoulder.x} y2={SIDE.shoulder.y} />
      <LaserSight
        x1={SIDE.phoneLens.x} y1={SIDE.phoneLens.y}
        x2={SIDE.hip.x} y2={SIDE.hip.y} coreOpacity={0.4} />
      <LaserSight
        x1={SIDE.phoneLens.x} y1={SIDE.phoneLens.y}
        x2={SIDE.ankle.x} y2={SIDE.ankle.y} coreOpacity={0.35} />

      {/* FOV cone fill */}
      <Path
        d={`M ${SIDE.phoneLens.x} ${SIDE.phoneLens.y} L ${SIDE.shoulder.x} ${SIDE.shoulder.y} L ${SIDE.ankle.x} ${SIDE.ankle.y} Z`}
        fill={COLORS.primary} opacity={0.02} />

      {/* Joint-alignment reticles */}
      <Reticle cx={SIDE.shoulder.x} cy={SIDE.shoulder.y} r={9} />
      <Reticle cx={SIDE.hip.x} cy={SIDE.hip.y} r={8} />
      <Reticle cx={SIDE.ankle.x} cy={SIDE.ankle.y} r={7} />

      {/* Phone — tilted back on floor (same position as original) */}
      <G rotation={-15} origin={SIDE.phoneOrigin}>
        {/* Glow aura behind phone */}
        <Ellipse cx={222} cy={172} rx={22} ry={34}
          fill={COLORS.primary} opacity={0.06} />
        {/* Phone body */}
        <Rect x={210} y={140} width={24} height={60} rx={4}
          stroke={COLORS.primary} strokeWidth={1.5} fill="rgba(139, 92, 246, 0.04)" />
        {/* Screen */}
        <Rect x={213} y={146} width={18} height={46} rx={2}
          stroke={COLORS.primary} strokeWidth={0.6} fill="rgba(139, 92, 246, 0.02)" opacity={0.6} />
        {/* Camera lens */}
        <Circle cx={222} cy={143} r={1.5} fill={COLORS.primary} opacity={0.8} />
        <Circle cx={222} cy={143} r={4} fill={COLORS.primary} opacity={0.2} />
        <Circle cx={222} cy={143} r={7} fill={COLORS.primary} opacity={0.06} />
      </G>

      {/* Lens emission glow at rotated position */}
      <Circle cx={SIDE.phoneLens.x} cy={SIDE.phoneLens.y} r={3}
        fill={COLORS.primary} opacity={0.4} />
      <Circle cx={SIDE.phoneLens.x} cy={SIDE.phoneLens.y} r={6}
        fill={COLORS.primary} opacity={0.1} />
    </Svg>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// FRONT VIEW — Holographic front model + V-cone sightlines + shoulder
// reticles + dashed violet frame border
// ─────────────────────────────────────────────────────────────────────────────

const FrontViewVisual: React.FC = () => (
  <View style={vizStyles.container}>
    {/* ── Background SVG ── */}
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="fGlow" cx="50%" cy="48%" r="38%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.12" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Violet aura behind figure */}
      <Ellipse
        cx={VIS_W / 2}
        cy={FRONT.img.y + FRONT.img.h / 2}
        rx={FRONT.img.w / 2 + 20}
        ry={FRONT.img.h / 2 + 10}
        fill="url(#fGlow)"
      />

      {/* Floor line */}
      <Line x1={20} y1={FLOOR_Y} x2={VIS_W - 20} y2={FLOOR_Y}
        stroke="#404040" strokeWidth={0.8} />
      <Line x1={20} y1={FLOOR_Y} x2={VIS_W - 20} y2={FLOOR_Y}
        stroke={COLORS.primary} strokeWidth={0.4} opacity={0.15} />
    </Svg>

    {/* ── Holographic human figure ── */}
    <HolographicFigure
      source={frontImg}
      x={FRONT.img.x} y={FRONT.img.y} w={FRONT.img.w} h={FRONT.img.h}
    />

    {/* ── Foreground SVG ── */}
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>

      {/* Dashed violet frame border — outer */}
      <Rect
        x={FRONT.img.x - 14} y={FRONT.img.y - 6}
        width={FRONT.img.w + 28} height={FRONT.img.h + 14}
        rx={4}
        stroke={COLORS.primary} strokeWidth={1}
        strokeDasharray="8,5" fill="none" opacity={0.28} />
      {/* Dashed violet frame border — inner */}
      <Rect
        x={FRONT.img.x - 7} y={FRONT.img.y + 1}
        width={FRONT.img.w + 14} height={FRONT.img.h + 2}
        rx={2}
        stroke={COLORS.primary} strokeWidth={0.5}
        strokeDasharray="4,6" fill="none" opacity={0.14} />

      {/* V-cone sightlines from phone → left shoulder, right shoulder */}
      <LaserSight x1={136} y1={204} x2={FRONT.lShoulder.x} y2={FRONT.lShoulder.y} dashed />
      <LaserSight x1={144} y1={204} x2={FRONT.rShoulder.x} y2={FRONT.rShoulder.y} dashed />

      {/* Subtle FOV cone fill */}
      <Path
        d={`M 136 204 L ${FRONT.lShoulder.x} ${FRONT.lShoulder.y} L ${FRONT.rShoulder.x} ${FRONT.rShoulder.y} L 144 204 Z`}
        fill={COLORS.primary} opacity={0.02} />

      {/* Shoulder crosshair reticles */}
      <Reticle cx={FRONT.lShoulder.x} cy={FRONT.lShoulder.y} r={9} />
      <Reticle cx={FRONT.rShoulder.x} cy={FRONT.rShoulder.y} r={9} />

      {/* Bilateral symmetry axis */}
      <Line x1={140} y1={FRONT.img.y - 10} x2={140} y2={FLOOR_Y}
        stroke={COLORS.primary} strokeWidth={0.5}
        strokeDasharray="2,6" opacity={0.12} />

      {/* Phone at bottom center (landscape) */}
      <G>
        {/* Glow under phone */}
        <Ellipse cx={140} cy={212} rx={24} ry={8}
          fill={COLORS.primary} opacity={0.08} />
        {/* Phone body */}
        <Rect x={122} y={204} width={36} height={16} rx={3}
          stroke={COLORS.primary} strokeWidth={1.5} fill="rgba(139, 92, 246, 0.04)" />
        {/* Camera dot */}
        <Circle cx={140} cy={207} r={1.5} fill={COLORS.primary} opacity={0.7} />
        <Circle cx={140} cy={207} r={3.5} fill={COLORS.primary} opacity={0.15} />
      </G>
    </Svg>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// ANY VIEW — Frame box + holographic front model + isometric floor grid
// + circular ring + phone on ring
// ─────────────────────────────────────────────────────────────────────────────

const AnyViewVisual: React.FC = () => (
  <View style={vizStyles.container}>
    {/* ── Background SVG ── */}
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="aGlow" cx="50%" cy="55%" r="40%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.1" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Violet aura */}
      <Ellipse
        cx={VIS_W / 2}
        cy={FRONT.img.y + FRONT.img.h / 2 + 10}
        rx={90}
        ry={FRONT.img.h / 2 + 15}
        fill="url(#aGlow)"
      />

      {/* Isometric floor grid — horizontal */}
      {[140, 155, 170, 185, 200].map((y, i) => (
        <Line key={`ah${i}`}
          x1={40 - i * 8} y1={y} x2={240 + i * 8} y2={y}
          stroke={COLORS.primary} strokeWidth={0.6}
          opacity={0.05 + i * 0.012} />
      ))}
      {/* Isometric floor grid — converging verticals */}
      {[-40, -20, 0, 20, 40].map((offset, i) => (
        <Line key={`av${i}`}
          x1={140 + offset * 2.2} y1={125}
          x2={140 + offset * 3} y2={210}
          stroke={COLORS.primary} strokeWidth={0.5}
          opacity={0.04} />
      ))}

      {/* Circular floor ring (perspective ellipse) */}
      <Ellipse cx={140} cy={175} rx={65} ry={22}
        stroke={COLORS.primary} strokeWidth={1.2} fill="none" opacity={0.35} />
      <Ellipse cx={140} cy={175} rx={65} ry={22}
        stroke={COLORS.primary} strokeWidth={3} fill="none" opacity={0.05} />
    </Svg>

    {/* ── Holographic human figure ── */}
    <HolographicFigure
      source={frontImg}
      x={FRONT.img.x} y={FRONT.img.y} w={FRONT.img.w} h={FRONT.img.h}
    />

    {/* ── Foreground SVG ── */}
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>

      {/* Bounding-box corner brackets [ ] around figure */}
      {/* Top-left */}
      <Path d="M 81 18 L 81 4 L 95 4"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />
      {/* Top-right */}
      <Path d="M 199 18 L 199 4 L 185 4"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />
      {/* Bottom-left */}
      <Path d="M 81 192 L 81 206 L 95 206"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />
      {/* Bottom-right */}
      <Path d="M 199 192 L 199 206 L 185 206"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />

      {/* Corner dots */}
      <Circle cx={81} cy={4} r={2} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={199} cy={4} r={2} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={81} cy={206} r={2} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={199} cy={206} r={2} fill={COLORS.primary} opacity={0.35} />

      {/* Phone on the floor ring */}
      <G>
        <Circle cx={205} cy={175} r={12} fill={COLORS.primary} opacity={0.08} />
        <Rect x={196} y={164} width={18} height={22} rx={3}
          stroke={COLORS.primary} strokeWidth={1.3} fill="rgba(139, 92, 246, 0.06)" />
        <Circle cx={205} cy={168} r={1.2} fill={COLORS.primary} opacity={0.7} />
        <Rect x={199} y={170} width={12} height={12} rx={1.5}
          stroke={COLORS.primary} strokeWidth={0.5} fill="none" opacity={0.3} />
      </G>

      {/* Connection line from phone to figure center */}
      <Line
        x1={196} y1={175}
        x2={FRONT.img.x + FRONT.img.w / 2 + 5}
        y2={FRONT.img.y + FRONT.img.h / 2}
        stroke={COLORS.primary} strokeWidth={0.7} strokeDasharray="4,4"
        opacity={0.2} strokeLinecap="round" />
    </Svg>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Visual container styles
// ─────────────────────────────────────────────────────────────────────────────

const vizStyles = StyleSheet.create({
  container: {
    width: VIS_W,
    height: VIS_H,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// View type label + visual picker
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_TYPE_LABEL: Record<string, string> = {
  SIDE: 'SIDE VIEW',
  FRONT: 'FRONT VIEW',
  ANY: 'ANY ANGLE',
};

const ArchetypeVisual: React.FC<{ viewType: string }> = ({ viewType }) => {
  switch (viewType) {
    case 'FRONT': return <FrontViewVisual />;
    case 'ANY':   return <AnyViewVisual />;
    default:      return <SideViewVisual />;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const CameraGuideModal: React.FC<CameraGuideModalProps> = ({
  visible,
  exerciseName,
  viewType,
  keySetup,
  reasonText,
  onClose,
}) => {
  const backdrop = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      // Reset sheet to off-screen before animating in
      translateY.setValue(SHEET_HEIGHT);
      Animated.parallel([
        Animated.timing(backdrop, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 9,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdrop, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: SHEET_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, backdrop, translateY]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Animate out, then call onClose
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [backdrop, translateY, onClose]);

  const handleGotIt = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start(() => handleClose());
  }, [buttonScale, handleClose]);

  if (!visible) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdrop }]}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleClose}
        />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY }] },
          Platform.OS === 'ios' && {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.4,
            shadowRadius: 16,
          },
        ]}
      >
        {/* Drag handle */}
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>

        {/* Close button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <X size={18} color={COLORS.textSecondary} strokeWidth={2} />
        </TouchableOpacity>

        {/* ── Top half: Visual Stage ── */}
        <View style={styles.visualStage}>
          {/* View type label */}
          <Text style={styles.viewTypeLabel}>
            {VIEW_TYPE_LABEL[viewType] ?? 'SIDE VIEW'}
          </Text>
          {/* Archetype visual */}
          <ArchetypeVisual viewType={viewType} />
        </View>

        {/* ── Bottom half: Data ── */}
        <View style={styles.dataSection}>
          {/* Exercise name */}
          <Text style={styles.exerciseName}>
            {exerciseName.toUpperCase()}
          </Text>

          {/* Key setup instruction */}
          <Text style={styles.keySetup}>
            {keySetup}
          </Text>

          {/* Reason text */}
          <Text style={styles.reasonText}>
            {reasonText}
          </Text>
        </View>

        {/* ── CTA Button ── */}
        <View style={styles.ctaContainer}>
          <Animated.View
            style={[
              styles.ctaWrapper,
              { transform: [{ scale: buttonScale }] },
              Platform.OS === 'ios' && {
                shadowColor: COLORS.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.5,
                shadowRadius: 20,
              },
            ]}
          >
            <TouchableOpacity onPress={handleGotIt} activeOpacity={0.85}>
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.ctaButton}
              >
                <Text style={styles.ctaText}>Got it</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: '#0E0E0E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 10 },
    }),
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  /* ── Visual Stage (top ~50%) ── */
  visualStage: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: 16,
  },
  viewTypeLabel: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.primary,
    letterSpacing: 4,
    marginBottom: 16,
  },

  /* ── Data Section (bottom ~50%) ── */
  dataSection: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  exerciseName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: 2,
    marginBottom: 10,
    opacity: 0.7,
  },
  keySetup: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.primary,
    letterSpacing: -0.3,
    lineHeight: 30,
    marginBottom: 10,
  },
  reasonText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },

  /* ── CTA ── */
  ctaContainer: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxl,
    paddingTop: SPACING.lg,
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
