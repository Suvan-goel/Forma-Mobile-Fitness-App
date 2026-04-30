import React from 'react';
import {
  View,
  Image,
  StyleSheet,
  Platform,
} from 'react-native';
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
import { COLORS } from '../../constants/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Visual stage constants
// ─────────────────────────────────────────────────────────────────────────────

export const VIS_W = 280;
export const VIS_H = 220;
const FLOOR_Y = 200;

// Image sources (loaded once at module level)
const sideSceneImg = require('../../../../assets/side-view-phone-v1.png');
const frontSceneImg = require('../../../../assets/front-view-phone-v1.png');
const frontImg = require('../../../../assets/front-view.png');

// Side view scene: generated person + recording phone in one transparent asset.
const SIDE = {
  img: { x: 52, y: 5, w: 70, h: 195 },
  shoulder: { x: 73, y: 47 },
  hip:      { x: 70, y: 105 },
  ankle:    { x: 69, y: 178 },
  phoneLens: { x: 232, y: 158 },
};

// Front view scene: generated person + recording phone in one transparent asset.
const FRONT = {
  img: { x: 99, y: 5, w: 82, h: 195 },
  lShoulder: { x: 115, y: 46 },
  rShoulder: { x: 165, y: 46 },
  phoneLens: { x: 140, y: 166 },
};

// ─────────────────────────────────────────────────────────────────────────────
// View type label map
// ─────────────────────────────────────────────────────────────────────────────

export const VIEW_TYPE_LABEL: Record<string, string> = {
  SIDE: 'SIDE VIEW',
  FRONT: 'FRONT VIEW',
  ANY: 'ANY ANGLE',
};

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

const HolographicScene: React.FC<{ source: any }> = ({ source }) => (
  <View
    style={[
      StyleSheet.absoluteFill,
      Platform.OS === 'ios' && {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 18,
      },
    ]}
  >
    <Image
      source={source}
      style={{ width: VIS_W, height: VIS_H, opacity: 0.88 }}
      resizeMode="contain"
    />
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// SIDE VIEW
// ─────────────────────────────────────────────────────────────────────────────

const SideViewVisual: React.FC = () => (
  <View style={vizStyles.container}>
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="sGlow" cx="40%" cy="48%" r="35%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.12" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <Ellipse
        cx={SIDE.img.x + SIDE.img.w / 2}
        cy={SIDE.img.y + SIDE.img.h / 2}
        rx={SIDE.img.w / 2 + 20}
        ry={SIDE.img.h / 2 + 10}
        fill="url(#sGlow)"
      />

      {[0, 1, 2, 3, 4, 5].map(i => (
        <Line key={`sh${i}`}
          x1={15} y1={FLOOR_Y - i * (4 + i * 0.5)}
          x2={VIS_W - 15} y2={FLOOR_Y - i * (4 + i * 0.5)}
          stroke={COLORS.primary} strokeWidth={0.5}
          opacity={0.12 - i * 0.016} />
      ))}
      {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(i => (
        <Line key={`sv${i}`}
          x1={VIS_W / 2 + i * 20} y1={178}
          x2={VIS_W / 2 + i * 28} y2={FLOOR_Y}
          stroke={COLORS.primary} strokeWidth={0.4}
          opacity={0.06} />
      ))}

      <Line x1={15} y1={FLOOR_Y} x2={VIS_W - 15} y2={FLOOR_Y}
        stroke={COLORS.primary} strokeWidth={0.6} opacity={0.25} />
      <Line x1={15} y1={FLOOR_Y} x2={VIS_W - 15} y2={FLOOR_Y}
        stroke="#404040" strokeWidth={0.4} />
    </Svg>

    <HolographicScene source={sideSceneImg} />

    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>

      <LaserSight
        x1={SIDE.phoneLens.x} y1={SIDE.phoneLens.y}
        x2={SIDE.shoulder.x} y2={SIDE.shoulder.y} />
      <LaserSight
        x1={SIDE.phoneLens.x} y1={SIDE.phoneLens.y}
        x2={SIDE.hip.x} y2={SIDE.hip.y} coreOpacity={0.4} />
      <LaserSight
        x1={SIDE.phoneLens.x} y1={SIDE.phoneLens.y}
        x2={SIDE.ankle.x} y2={SIDE.ankle.y} coreOpacity={0.35} />

      <Path
        d={`M ${SIDE.phoneLens.x} ${SIDE.phoneLens.y} L ${SIDE.shoulder.x} ${SIDE.shoulder.y} L ${SIDE.ankle.x} ${SIDE.ankle.y} Z`}
        fill={COLORS.primary} opacity={0.02} />

      <Reticle cx={SIDE.shoulder.x} cy={SIDE.shoulder.y} r={9} />
      <Reticle cx={SIDE.hip.x} cy={SIDE.hip.y} r={8} />
      <Reticle cx={SIDE.ankle.x} cy={SIDE.ankle.y} r={7} />

      <Circle cx={SIDE.phoneLens.x} cy={SIDE.phoneLens.y} r={3}
        fill={COLORS.primary} opacity={0.4} />
      <Circle cx={SIDE.phoneLens.x} cy={SIDE.phoneLens.y} r={6}
        fill={COLORS.primary} opacity={0.1} />
    </Svg>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// FRONT VIEW
// ─────────────────────────────────────────────────────────────────────────────

const FrontViewVisual: React.FC = () => (
  <View style={vizStyles.container}>
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="fGlow" cx="50%" cy="48%" r="38%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.12" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <Ellipse
        cx={VIS_W / 2}
        cy={FRONT.img.y + FRONT.img.h / 2}
        rx={FRONT.img.w / 2 + 20}
        ry={FRONT.img.h / 2 + 10}
        fill="url(#fGlow)"
      />

      <Line x1={20} y1={FLOOR_Y} x2={VIS_W - 20} y2={FLOOR_Y}
        stroke="#404040" strokeWidth={0.8} />
      <Line x1={20} y1={FLOOR_Y} x2={VIS_W - 20} y2={FLOOR_Y}
        stroke={COLORS.primary} strokeWidth={0.4} opacity={0.15} />
    </Svg>

    <HolographicScene source={frontSceneImg} />

    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>

      <Rect
        x={FRONT.img.x - 14} y={FRONT.img.y - 6}
        width={FRONT.img.w + 28} height={FRONT.img.h + 14}
        rx={4}
        stroke={COLORS.primary} strokeWidth={1}
        strokeDasharray="8,5" fill="none" opacity={0.28} />
      <Rect
        x={FRONT.img.x - 7} y={FRONT.img.y + 1}
        width={FRONT.img.w + 14} height={FRONT.img.h + 2}
        rx={2}
        stroke={COLORS.primary} strokeWidth={0.5}
        strokeDasharray="4,6" fill="none" opacity={0.14} />

      <LaserSight x1={136} y1={FRONT.phoneLens.y} x2={FRONT.lShoulder.x} y2={FRONT.lShoulder.y} dashed />
      <LaserSight x1={144} y1={FRONT.phoneLens.y} x2={FRONT.rShoulder.x} y2={FRONT.rShoulder.y} dashed />

      <Path
        d={`M 136 ${FRONT.phoneLens.y} L ${FRONT.lShoulder.x} ${FRONT.lShoulder.y} L ${FRONT.rShoulder.x} ${FRONT.rShoulder.y} L 144 ${FRONT.phoneLens.y} Z`}
        fill={COLORS.primary} opacity={0.02} />

      <Reticle cx={FRONT.lShoulder.x} cy={FRONT.lShoulder.y} r={9} />
      <Reticle cx={FRONT.rShoulder.x} cy={FRONT.rShoulder.y} r={9} />

      <Line x1={140} y1={FRONT.img.y - 10} x2={140} y2={FLOOR_Y}
        stroke={COLORS.primary} strokeWidth={0.5}
        strokeDasharray="2,6" opacity={0.12} />

      <Circle cx={FRONT.phoneLens.x} cy={FRONT.phoneLens.y} r={2}
        fill={COLORS.primary} opacity={0.5} />
      <Circle cx={FRONT.phoneLens.x} cy={FRONT.phoneLens.y} r={5}
        fill={COLORS.primary} opacity={0.12} />
    </Svg>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// ANY VIEW
// ─────────────────────────────────────────────────────────────────────────────

const AnyViewVisual: React.FC = () => (
  <View style={vizStyles.container}>
    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="aGlow" cx="50%" cy="55%" r="40%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.1" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <Ellipse
        cx={VIS_W / 2}
        cy={FRONT.img.y + FRONT.img.h / 2 + 10}
        rx={90}
        ry={FRONT.img.h / 2 + 15}
        fill="url(#aGlow)"
      />

      {[140, 155, 170, 185, 200].map((y, i) => (
        <Line key={`ah${i}`}
          x1={40 - i * 8} y1={y} x2={240 + i * 8} y2={y}
          stroke={COLORS.primary} strokeWidth={0.6}
          opacity={0.05 + i * 0.012} />
      ))}
      {[-40, -20, 0, 20, 40].map((offset, i) => (
        <Line key={`av${i}`}
          x1={140 + offset * 2.2} y1={125}
          x2={140 + offset * 3} y2={210}
          stroke={COLORS.primary} strokeWidth={0.5}
          opacity={0.04} />
      ))}

      <Ellipse cx={140} cy={175} rx={65} ry={22}
        stroke={COLORS.primary} strokeWidth={1.2} fill="none" opacity={0.35} />
      <Ellipse cx={140} cy={175} rx={65} ry={22}
        stroke={COLORS.primary} strokeWidth={3} fill="none" opacity={0.05} />
    </Svg>

    <HolographicFigure
      source={frontImg}
      x={FRONT.img.x} y={FRONT.img.y} w={FRONT.img.w} h={FRONT.img.h}
    />

    <Svg width={VIS_W} height={VIS_H} viewBox={`0 0 ${VIS_W} ${VIS_H}`}
      style={StyleSheet.absoluteFill}>

      <Path d="M 81 18 L 81 4 L 95 4"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />
      <Path d="M 199 18 L 199 4 L 185 4"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />
      <Path d="M 81 192 L 81 206 L 95 206"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />
      <Path d="M 199 192 L 199 206 L 185 206"
        stroke={COLORS.primary} strokeWidth={1.5}
        fill="none" strokeLinecap="round" opacity={0.55} />

      <Circle cx={81} cy={4} r={2} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={199} cy={4} r={2} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={81} cy={206} r={2} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={199} cy={206} r={2} fill={COLORS.primary} opacity={0.35} />

      <G>
        <Circle cx={205} cy={175} r={12} fill={COLORS.primary} opacity={0.08} />
        <Rect x={196} y={164} width={18} height={22} rx={3}
          stroke={COLORS.primary} strokeWidth={1.3} fill="rgba(139, 92, 246, 0.06)" />
        <Circle cx={205} cy={168} r={1.2} fill={COLORS.primary} opacity={0.7} />
        <Rect x={199} y={170} width={12} height={12} rx={1.5}
          stroke={COLORS.primary} strokeWidth={0.5} fill="none" opacity={0.3} />
      </G>

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
// View type visual picker
// ─────────────────────────────────────────────────────────────────────────────

export const ArchetypeVisual: React.FC<{ viewType: string }> = ({ viewType }) => {
  switch (viewType) {
    case 'FRONT': return <FrontViewVisual />;
    case 'ANY':   return <AnyViewVisual />;
    default:      return <SideViewVisual />;
  }
};
