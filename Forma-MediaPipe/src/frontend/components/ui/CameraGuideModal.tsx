import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  Platform,
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
// SVG Archetype: SIDE VIEW
// Wireframe human side-profile + phone with connecting laser line
// ─────────────────────────────────────────────────────────────────────────────

const SideViewSVG: React.FC = () => {
  // Phone grounded on floor at right, tilted back ~15deg, camera lens near top-left edge
  // Lens position after rotation (origin 222,178): approximately x=215, y=157
  const LENS_X = 215;
  const LENS_Y = 157;
  // FOV targets: figure head top and figure feet
  const HEAD_X = 100;
  const HEAD_Y = 32;
  const FEET_X = 86;
  const FEET_Y = 200;

  return (
    <Svg width={280} height={220} viewBox="0 0 280 220">
      <Defs>
        <RadialGradient id="sideGlow" cx="50%" cy="80%" r="50%">
          <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.14" />
          <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Floor line */}
      <Line x1={20} y1={200} x2={260} y2={200} stroke="#404040" strokeWidth={0.8} />
      <Line x1={20} y1={200} x2={260} y2={200} stroke={COLORS.primary} strokeWidth={0.4} opacity={0.15} />

      {/* ── Human side-profile wireframe (facing RIGHT toward phone) ── */}
      <G>
        {/* Head */}
        <Circle cx={100} cy={48} r={16} stroke="#404040" strokeWidth={1.5} fill="none" />
        <Circle cx={100} cy={48} r={16} stroke={COLORS.primary} strokeWidth={0.5} fill="none" opacity={0.1} />
        {/* Eye hint — on right side (facing phone) */}
        <Circle cx={108} cy={46} r={1.5} fill="#404040" opacity={0.6} />

        {/* Neck */}
        <Line x1={100} y1={64} x2={102} y2={78} stroke="#404040" strokeWidth={1.5} strokeLinecap="round" />

        {/* Torso — very slight backward lean for natural side stance */}
        <Line x1={102} y1={78} x2={105} y2={130} stroke="#404040" strokeWidth={1.5} strokeLinecap="round" />

        {/* Shoulder joint */}
        <Circle cx={102} cy={78} r={3} fill="#404040" opacity={0.5} />

        {/* Upper arm (hangs slightly forward) */}
        <Line x1={102} y1={78} x2={108} y2={108} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
        {/* Elbow */}
        <Circle cx={108} cy={108} r={2.5} fill="#404040" opacity={0.5} />
        {/* Forearm */}
        <Line x1={108} y1={108} x2={112} y2={132} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />

        {/* Hip joint */}
        <Circle cx={105} cy={130} r={3} fill="#404040" opacity={0.5} />

        {/* Upper leg */}
        <Line x1={105} y1={130} x2={102} y2={166} stroke="#404040" strokeWidth={1.5} strokeLinecap="round" />
        {/* Knee */}
        <Circle cx={102} cy={166} r={2.5} fill="#404040" opacity={0.5} />
        {/* Lower leg */}
        <Line x1={102} y1={166} x2={100} y2={198} stroke="#404040" strokeWidth={1.5} strokeLinecap="round" />
        {/* Foot — pointing right toward phone */}
        <Line x1={100} y1={198} x2={86} y2={200} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      </G>

      {/* ── Phone grounded on floor, tilted back ── */}
      <G rotation={-15} origin="222, 178">
        {/* Glow aura behind phone */}
        <Ellipse cx={222} cy={172} rx={22} ry={34} fill="url(#sideGlow)" />

        {/* Phone body — bottom edge at floor (y+height ≈ 200 pre-rotation) */}
        <Rect x={210} y={140} width={24} height={60} rx={4}
          stroke={COLORS.primary} strokeWidth={1.5} fill="rgba(139, 92, 246, 0.04)" />
        {/* Screen */}
        <Rect x={213} y={146} width={18} height={46} rx={2}
          stroke={COLORS.primary} strokeWidth={0.6} fill="rgba(139, 92, 246, 0.02)" opacity={0.6} />
        {/* Camera lens (top edge) */}
        <Circle cx={222} cy={143} r={1.5} fill={COLORS.primary} opacity={0.8} />
        {/* Lens glow rings */}
        <Circle cx={222} cy={143} r={4} fill={COLORS.primary} opacity={0.2} />
        <Circle cx={222} cy={143} r={7} fill={COLORS.primary} opacity={0.06} />
      </G>

      {/* ── Field of View — two dashed lines from lens to head & feet ── */}
      {/* Upper FOV line: lens → top of head */}
      <Line x1={LENS_X} y1={LENS_Y} x2={HEAD_X} y2={HEAD_Y}
        stroke={COLORS.primary} strokeWidth={1} strokeDasharray="5,4"
        opacity={0.5} strokeLinecap="round" />
      {/* Lower FOV line: lens → feet */}
      <Line x1={LENS_X} y1={LENS_Y} x2={FEET_X} y2={FEET_Y}
        stroke={COLORS.primary} strokeWidth={1} strokeDasharray="5,4"
        opacity={0.5} strokeLinecap="round" />

      {/* FOV cone fill — subtle triangular area */}
      <Path d={`M ${LENS_X} ${LENS_Y} L ${HEAD_X} ${HEAD_Y} L ${FEET_X} ${FEET_Y} Z`}
        fill={COLORS.primary} opacity={0.025} />

      {/* Glow dots at FOV endpoints */}
      <Circle cx={LENS_X} cy={LENS_Y} r={3} fill={COLORS.primary} opacity={0.45} />
      <Circle cx={LENS_X} cy={LENS_Y} r={6} fill={COLORS.primary} opacity={0.1} />
      <Circle cx={HEAD_X} cy={HEAD_Y} r={2} fill={COLORS.primary} opacity={0.2} />
      <Circle cx={FEET_X} cy={FEET_Y} r={2} fill={COLORS.primary} opacity={0.2} />
    </Svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG Archetype: FRONT VIEW
// Wireframe human facing forward + phone at bottom shooting laser lines
// ─────────────────────────────────────────────────────────────────────────────

const FrontViewSVG: React.FC = () => (
  <Svg width={280} height={220} viewBox="0 0 280 220">
    <Defs>
      <RadialGradient id="frontGlow" cx="50%" cy="85%" r="45%">
        <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.15" />
        <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
      </RadialGradient>
    </Defs>

    {/* Floor line */}
    <Line x1={20} y1={200} x2={260} y2={200} stroke="#404040" strokeWidth={0.8} />

    {/* ── Human front-facing wireframe ── */}
    <G>
      {/* Head */}
      <Circle cx={140} cy={38} r={16} stroke="#404040" strokeWidth={1.5} fill="none" />
      <Circle cx={140} cy={38} r={16} stroke={COLORS.primary} strokeWidth={0.5} fill="none" opacity={0.1} />

      {/* Neck */}
      <Line x1={140} y1={54} x2={140} y2={68} stroke="#404040" strokeWidth={1.5} strokeLinecap="round" />

      {/* Shoulders (horizontal bar) */}
      <Line x1={100} y1={68} x2={180} y2={68} stroke="#404040" strokeWidth={1.5} strokeLinecap="round" />

      {/* Shoulder joints — glowing violet to indicate tracking targets */}
      <Circle cx={100} cy={68} r={4} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={100} cy={68} r={7} fill={COLORS.primary} opacity={0.08} />
      <Circle cx={180} cy={68} r={4} fill={COLORS.primary} opacity={0.35} />
      <Circle cx={180} cy={68} r={7} fill={COLORS.primary} opacity={0.08} />

      {/* Torso sides */}
      <Line x1={115} y1={68} x2={112} y2={130} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={165} y1={68} x2={168} y2={130} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      {/* Spine */}
      <Line x1={140} y1={68} x2={140} y2={130} stroke="#404040" strokeWidth={0.6} strokeDasharray="3,3" opacity={0.3} />

      {/* Upper arms */}
      <Line x1={100} y1={68} x2={82} y2={108} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={180} y1={68} x2={198} y2={108} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      {/* Elbows */}
      <Circle cx={82} cy={108} r={2.5} fill="#404040" opacity={0.5} />
      <Circle cx={198} cy={108} r={2.5} fill="#404040" opacity={0.5} />
      {/* Forearms */}
      <Line x1={82} y1={108} x2={76} y2={140} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={198} y1={108} x2={204} y2={140} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />

      {/* Hips */}
      <Line x1={112} y1={130} x2={168} y2={130} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      <Circle cx={112} cy={130} r={2.5} fill="#404040" opacity={0.5} />
      <Circle cx={168} cy={130} r={2.5} fill="#404040" opacity={0.5} />

      {/* Legs */}
      <Line x1={120} y1={130} x2={118} y2={166} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={160} y1={130} x2={162} y2={166} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      {/* Knees */}
      <Circle cx={118} cy={166} r={2} fill="#404040" opacity={0.5} />
      <Circle cx={162} cy={166} r={2} fill="#404040" opacity={0.5} />
      {/* Shins */}
      <Line x1={118} y1={166} x2={116} y2={198} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      <Line x1={162} y1={166} x2={164} y2={198} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
    </G>

    {/* ── Phone at bottom center ── */}
    <G>
      {/* Glow under phone */}
      <Ellipse cx={140} cy={212} rx={24} ry={8} fill={COLORS.primary} opacity={0.08} />

      {/* Phone body (landscape) */}
      <Rect x={122} y={204} width={36} height={16} rx={3}
        stroke={COLORS.primary} strokeWidth={1.5} fill="rgba(139, 92, 246, 0.04)" />
      {/* Camera dot */}
      <Circle cx={140} cy={207} r={1.5} fill={COLORS.primary} opacity={0.7} />
      <Circle cx={140} cy={207} r={3.5} fill={COLORS.primary} opacity={0.15} />
    </G>

    {/* ── Diverging laser lines — phone → left shoulder, phone → right shoulder ── */}
    <Line x1={136} y1={204} x2={100} y2={72}
      stroke={COLORS.primary} strokeWidth={1} strokeDasharray="5,4"
      opacity={0.45} strokeLinecap="round" />
    <Line x1={144} y1={204} x2={180} y2={72}
      stroke={COLORS.primary} strokeWidth={1} strokeDasharray="5,4"
      opacity={0.45} strokeLinecap="round" />

    {/* Subtle field-of-view fill */}
    <Path d="M 136 204 L 100 72 L 180 72 L 144 204 Z"
      fill={COLORS.primary} opacity={0.02} />

    {/* Bilateral symmetry axis */}
    <Line x1={140} y1={22} x2={140} y2={200}
      stroke={COLORS.primary} strokeWidth={0.5} strokeDasharray="2,6"
      opacity={0.12} />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// SVG Archetype: ANY VIEW
// Isometric floor grid + figure + circular ring + bounding box
// ─────────────────────────────────────────────────────────────────────────────

const AnyViewSVG: React.FC = () => (
  <Svg width={280} height={220} viewBox="0 0 280 220">
    <Defs>
      <RadialGradient id="anyGlow" cx="50%" cy="60%" r="40%">
        <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.1" />
        <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
      </RadialGradient>
    </Defs>

    {/* ── Isometric floor grid ── */}
    {/* Horizontal lines */}
    {[140, 155, 170, 185, 200].map((y, i) => (
      <Line key={`h${i}`}
        x1={40 - i * 8} y1={y} x2={240 + i * 8} y2={y}
        stroke="rgba(255,255,255,0.04)" strokeWidth={0.6} />
    ))}
    {/* Converging verticals for perspective */}
    {[-40, -20, 0, 20, 40].map((offset, i) => (
      <Line key={`v${i}`}
        x1={140 + offset * 2.2} y1={125}
        x2={140 + offset * 3} y2={210}
        stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
    ))}

    {/* ── Circular ring on floor (ellipse for perspective) ── */}
    <Ellipse cx={140} cy={175} rx={65} ry={22}
      stroke={COLORS.primary} strokeWidth={1.2} fill="none" opacity={0.4} />
    <Ellipse cx={140} cy={175} rx={65} ry={22}
      stroke={COLORS.primary} strokeWidth={3} fill="none" opacity={0.06} />

    {/* ── Human figure (simplified front) ── */}
    <G>
      {/* Head */}
      <Circle cx={140} cy={48} r={13} stroke="#404040" strokeWidth={1.5} fill="none" />
      {/* Neck */}
      <Line x1={140} y1={61} x2={140} y2={72} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      {/* Shoulders */}
      <Line x1={112} y1={72} x2={168} y2={72} stroke="#404040" strokeWidth={1.3} strokeLinecap="round" />
      {/* Arms */}
      <Line x1={112} y1={72} x2={104} y2={108} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
      <Line x1={168} y1={72} x2={176} y2={108} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
      {/* Torso */}
      <Line x1={120} y1={72} x2={118} y2={120} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
      <Line x1={160} y1={72} x2={162} y2={120} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
      {/* Hips */}
      <Line x1={118} y1={120} x2={162} y2={120} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
      {/* Legs */}
      <Line x1={124} y1={120} x2={122} y2={158} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
      <Line x1={156} y1={120} x2={158} y2={158} stroke="#404040" strokeWidth={1.2} strokeLinecap="round" />
    </G>

    {/* ── Bounding box [  ] around figure ── */}
    {/* Top-left bracket */}
    <Path d="M 85 30 L 85 22 L 95 22" stroke={COLORS.primary} strokeWidth={1.5}
      fill="none" strokeLinecap="round" opacity={0.55} />
    {/* Top-right bracket */}
    <Path d="M 195 30 L 195 22 L 185 22" stroke={COLORS.primary} strokeWidth={1.5}
      fill="none" strokeLinecap="round" opacity={0.55} />
    {/* Bottom-left bracket */}
    <Path d="M 85 155 L 85 163 L 95 163" stroke={COLORS.primary} strokeWidth={1.5}
      fill="none" strokeLinecap="round" opacity={0.55} />
    {/* Bottom-right bracket */}
    <Path d="M 195 155 L 195 163 L 185 163" stroke={COLORS.primary} strokeWidth={1.5}
      fill="none" strokeLinecap="round" opacity={0.55} />

    {/* Bracket corner dots */}
    <Circle cx={85} cy={22} r={2} fill={COLORS.primary} opacity={0.35} />
    <Circle cx={195} cy={22} r={2} fill={COLORS.primary} opacity={0.35} />
    <Circle cx={85} cy={163} r={2} fill={COLORS.primary} opacity={0.35} />
    <Circle cx={195} cy={163} r={2} fill={COLORS.primary} opacity={0.35} />

    {/* ── Phone on the ring ── */}
    <G>
      {/* Phone glow */}
      <Circle cx={205} cy={175} r={12} fill={COLORS.primary} opacity={0.08} />
      {/* Phone body */}
      <Rect x={196} y={164} width={18} height={22} rx={3}
        stroke={COLORS.primary} strokeWidth={1.3} fill="rgba(139, 92, 246, 0.06)" />
      {/* Camera dot */}
      <Circle cx={205} cy={168} r={1.2} fill={COLORS.primary} opacity={0.7} />
      {/* Screen */}
      <Rect x={199} y={170} width={12} height={12} rx={1.5}
        stroke={COLORS.primary} strokeWidth={0.5} fill="none" opacity={0.3} />
    </G>

    {/* Subtle connection from phone to figure center */}
    <Line x1={196} y1={175} x2={162} y2={120}
      stroke={COLORS.primary} strokeWidth={0.7} strokeDasharray="4,4"
      opacity={0.25} strokeLinecap="round" />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// View type label + SVG picker
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_TYPE_LABEL: Record<string, string> = {
  SIDE: 'SIDE VIEW',
  FRONT: 'FRONT VIEW',
  ANY: 'ANY ANGLE',
};

const ArchetypeSVG: React.FC<{ viewType: string }> = ({ viewType }) => {
  switch (viewType) {
    case 'FRONT': return <FrontViewSVG />;
    case 'ANY':   return <AnyViewSVG />;
    default:      return <SideViewSVG />;
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
          {/* Archetype SVG */}
          <ArchetypeSVG viewType={viewType} />
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
