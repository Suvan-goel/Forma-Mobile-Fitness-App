import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { RNMediapipe, switchCamera } from '@thinksys/react-native-mediapipe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlipHorizontal, Pause, Play, Info, Dumbbell } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { RootStackParamList, RecordStackParamList } from '../app/RootNavigator';
import { detectExercise, updateRepCount, Keypoint } from '../utils/poseAnalysis';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 3:4 portrait aspect ratio (width:height) – taller than wide, like typical phone cameras
const CAMERA_ASPECT_WIDTH = 3;
const CAMERA_ASPECT_HEIGHT = 4;
const cameraDisplayWidth = SCREEN_WIDTH;
const cameraDisplayHeight = (SCREEN_WIDTH * CAMERA_ASPECT_HEIGHT) / CAMERA_ASPECT_WIDTH; // width * 4/3

// Camera can be called from either the root stack or the record stack
type CameraScreenRouteProp = RouteProp<RootStackParamList, 'Camera'> | RouteProp<RecordStackParamList, 'Camera'>;
type CameraScreenNavigationProp = NativeStackNavigationProp<RootStackParamList | RecordStackParamList>;

// MediaPipe landmark names (33 landmarks)
const MEDIAPIPE_LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index'
];

export const CameraScreen: React.FC = () => {
  const navigation = useNavigation<CameraScreenNavigationProp>();
  const route = useRoute<CameraScreenRouteProp>();
  const insets = useSafeAreaInsets();
  const { addSet } = useCurrentWorkout();
  
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentExercise, setCurrentExercise] = useState<string | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [currentFormScore, setCurrentFormScore] = useState<number | null>(null);
  const [currentEffortScore, setCurrentEffortScore] = useState<number | null>(null);
  const [exercisePhase, setExercisePhase] = useState<'up' | 'down' | 'idle'>('idle');
  const [workoutStartTime, setWorkoutStartTime] = useState<Date | null>(null);
  const [workoutData, setWorkoutData] = useState({
    totalReps: 0,
    formScores: [] as number[],
    effortScores: [] as number[],
    duration: 0,
  });

  const category = route.params?.category ?? 'Weightlifting';
  const exerciseNameFromRoute = (route.params as any)?.exerciseName;
  const returnToCurrentWorkout = (route.params as any)?.returnToCurrentWorkout ?? false;
  const cameraSessionKey = (route.params as any)?.cameraSessionKey ?? 'default';

  // Unmount camera before leaving so native layer can release it; avoids "Camera initialization failed" on next open
  const [cameraMounted, setCameraMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Delay mount slightly when screen gains focus so previous native camera has time to release
  useFocusEffect(
    useCallback(() => {
      if (isClosing) return;
      setCameraMounted(false);
      const t = setTimeout(() => setCameraMounted(true), 400);
      return () => clearTimeout(t);
    }, [isClosing])
  );

  // Use refs to track exercise state without triggering re-renders
  const exercisePhaseRef = useRef(exercisePhase);
  const repCountRef = useRef(repCount);
  const currentExerciseRef = useRef(currentExercise);
  const lastDetectionTimeRef = useRef(0);
  
  // Sync refs with state
  useEffect(() => {
    exercisePhaseRef.current = exercisePhase;
  }, [exercisePhase]);
  
  useEffect(() => {
    repCountRef.current = repCount;
  }, [repCount]);
  
  useEffect(() => {
    currentExerciseRef.current = currentExercise;
  }, [currentExercise]);

  // Track workout duration
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isPaused && workoutStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((new Date().getTime() - workoutStartTime.getTime()) / 1000);
        setWorkoutData(prev => ({ ...prev, duration: elapsed }));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused, workoutStartTime]);

  // Convert MediaPipe landmark data to our Keypoint format
  const convertLandmarksToKeypoints = useCallback((landmarkData: any): Keypoint[] | null => {
    if (!landmarkData || !Array.isArray(landmarkData)) return null;

    try {
      const keypoints: Keypoint[] = landmarkData.map((landmark: any, index: number) => ({
        name: MEDIAPIPE_LANDMARK_NAMES[index] || `landmark_${index}`,
        x: landmark.x || 0,
        y: landmark.y || 0,
        score: landmark.visibility !== undefined ? landmark.visibility : 1.0,
      }));

      return keypoints;
    } catch (error) {
      console.error('Error converting landmarks:', error);
      return null;
    }
  }, []);

  // Handle landmark data from MediaPipe with optimized throttling
  const handleLandmark = useCallback((data: any) => {
    if (!isRecording || isPaused) return;

    // Reduced throttle to 16ms (~60fps) for ultra-low latency
    // Most devices can handle 60fps, provides smooth real-time feedback
    const now = Date.now();
    if (now - lastDetectionTimeRef.current < 16) {
      return;
    }
    lastDetectionTimeRef.current = now;

    const keypoints = convertLandmarksToKeypoints(data);
    if (!keypoints || keypoints.length === 0) return;

    // Run exercise detection
    const detection = detectExercise(keypoints);
    
    if (detection.exercise && detection.angle !== null) {
      const exerciseName = detection.exercise;
      
      // Update exercise name if changed
      if (currentExerciseRef.current !== exerciseName) {
        setCurrentExercise(exerciseName);
        setExercisePhase('idle');
        return;
      }

      // Count reps based on angle changes
      const repUpdate = updateRepCount(
        exerciseName,
        detection.angle,
        exercisePhaseRef.current,
        repCountRef.current
      );

      // Only update state if something changed
      if (repUpdate.phase !== exercisePhaseRef.current) {
        setExercisePhase(repUpdate.phase);
      }

      // Rep completed
      if (repUpdate.repCount > repCountRef.current) {
        const formScore = repUpdate.formScore;
        const effortScore = Math.min(95, 75 + Math.floor(detection.confidence * 20));
        
        setRepCount(repUpdate.repCount);
        setCurrentFormScore(formScore);
        setCurrentEffortScore(effortScore);
        
        // Update workout data with functional update to avoid stale closures
        setWorkoutData(prev => ({
          ...prev,
          totalReps: prev.totalReps + 1,
          formScores: [...prev.formScores, formScore],
          effortScores: [...prev.effortScores, effortScore],
        }));
      }
    } else if (currentExerciseRef.current !== null) {
      // No exercise detected - reset
      setCurrentExercise(null);
      setExercisePhase('idle');
    }
  }, [isRecording, isPaused, convertLandmarksToKeypoints]);

  // Memoize button handlers to prevent recreating on every render
  const handleRecordPress = useCallback(() => {
    if (isRecording) {
      // Stop recording
      setIsRecording(false);
      
      // Calculate workout data
      const avgFormScore = workoutData.formScores.length > 0
        ? Math.round(workoutData.formScores.reduce((a, b) => a + b, 0) / workoutData.formScores.length)
        : 0;
      const avgEffortScore = workoutData.effortScores.length > 0
        ? Math.round(workoutData.effortScores.reduce((a, b) => a + b, 0) / workoutData.effortScores.length)
        : 0;

      // Check if this is from the Record stack (Current Workout flow)
      if (returnToCurrentWorkout && exerciseNameFromRoute) {
        const newSet = {
          exerciseName: exerciseNameFromRoute,
          reps: workoutData.totalReps,
          weight: 0,
          formScore: avgFormScore,
          effortScore: avgEffortScore,
        };
        addSet(newSet);
        // Unmount camera first so native layer releases it; prevents "Camera initialization failed" on next open
        setIsClosing(true);
        setCameraMounted(false);
        setTimeout(() => {
          (navigation as any).navigate('CurrentWorkout');
        }, 450);
      } else {
        // Original flow: navigate to SaveWorkout
        const minutes = Math.floor(workoutData.duration / 60);
        const seconds = workoutData.duration % 60;
        const durationString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const workoutDataToSave = {
          category,
          duration: durationString,
          totalReps: workoutData.totalReps,
          avgFormScore,
          avgEffortScore,
        };

        setTimeout(() => {
          (navigation as any).replace('SaveWorkout', {
            workoutData: workoutDataToSave,
          });
        }, 100);
      }
    } else {
      // Start recording
      setIsRecording(true);
      setWorkoutStartTime(new Date());
      // If exercise name is provided from route, use it; otherwise let detection handle it
      setCurrentExercise(exerciseNameFromRoute || null);
      setRepCount(0);
      setCurrentFormScore(null);
      setCurrentEffortScore(null);
      setIsPaused(false);
      setWorkoutData({
        totalReps: 0,
        formScores: [],
        effortScores: [],
        duration: 0,
      });
    }
  }, [isRecording, workoutData, category, exerciseNameFromRoute, returnToCurrentWorkout, navigation, addSet]);

  const handlePausePress = useCallback(() => {
    setIsPaused(!isPaused);
  }, [isPaused]);

  const handleCameraFlip = useCallback(() => {
    switchCamera();
  }, []);

  const handleInfoPress = useCallback(() => {
    (navigation as any).push('WorkoutInfo');
  }, [navigation]);

  // Memoize MediaPipe props – 3:4 portrait (taller than wide)
  const mediapipeProps = useMemo(() => ({
    width: cameraDisplayWidth,
    height: cameraDisplayHeight,
    face: true,
    leftArm: true,
    rightArm: true,
    torso: true,
    leftLeg: true,
    rightLeg: true,
    leftWrist: true,
    rightWrist: true,
    leftAnkle: true,
    rightAnkle: true,
  }), []);

  // Memoize display values to avoid recalculation
  const displayValues = useMemo(() => ({
    reps: repCount > 0 ? repCount : '-',
    form: repCount > 0 && currentFormScore !== null ? currentFormScore : '-',
    effort: repCount > 0 && currentEffortScore !== null ? currentEffortScore : '-',
    exerciseName: currentExercise || 'No Exercise Detected',
    exerciseColor: currentExercise ? COLORS.primary : COLORS.textSecondary,
  }), [repCount, currentFormScore, currentEffortScore, currentExercise]);

  const showCamera = cameraMounted && !isClosing;

  return (
    <View style={styles.container}>
      {/* Letterbox: center camera at 3:4 portrait with equal black bars above/below */}
      <View style={styles.cameraLetterbox}>
        <View style={[styles.cameraContainer, { width: cameraDisplayWidth, height: cameraDisplayHeight }]}>
          {showCamera && (
            <RNMediapipe
              key={String(cameraSessionKey)}
              {...mediapipeProps}
              onLandmark={handleLandmark}
            />
          )}
        </View>
      </View>

      {/* Overlay UI */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top Bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + SPACING.xs }]}>
          <View style={styles.weightsIconContainer}>
            <Dumbbell size={24} color={COLORS.text} />
          </View>
          <View style={styles.exerciseTopCard}>
            <Text style={styles.detectionLabel}>EXERCISE</Text>
            <Text style={[
              styles.detectionExercise,
              { color: displayValues.exerciseColor }
            ]}>
              {displayValues.exerciseName}
            </Text>
          </View>
          <TouchableOpacity style={styles.flipButton} onPress={handleCameraFlip}>
            <FlipHorizontal size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* Bottom Controls */}
        <View style={[
          styles.bottomBar,
          {
            paddingBottom: SPACING.lg + insets.bottom,
          }
        ]}>
          {/* Metrics Row */}
          <View style={[styles.metricsContainer, { marginBottom: SPACING.lg }]}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Reps</Text>
              <MonoText style={styles.metricValue}>
                {displayValues.reps}
              </MonoText>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Form</Text>
              <MonoText style={styles.metricValue}>
                {displayValues.form}
              </MonoText>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Effort</Text>
              <MonoText style={styles.metricValue}>
                {displayValues.effort}
              </MonoText>
            </View>
          </View>

          {/* Control Buttons */}
          <View style={styles.recordButtonContainer}>
            <View style={styles.buttonsRow}>
              <TouchableOpacity 
                style={[
                  styles.pauseButton,
                  !isRecording && styles.pauseButtonDisabled
                ]} 
                onPress={isRecording ? handlePausePress : undefined}
                activeOpacity={isRecording ? 0.8 : 1}
                disabled={!isRecording}
              >
                {isPaused ? (
                  <Play size={24} color={isRecording ? COLORS.text : COLORS.textSecondary} />
                ) : (
                  <Pause size={24} color={isRecording ? COLORS.text : COLORS.textSecondary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.recordButton, isRecording && styles.recordButtonActive]} 
                onPress={handleRecordPress}
                activeOpacity={0.8}
              >
                <View style={[styles.recordButtonInner, isRecording && styles.recordButtonInnerActive]} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.infoButton} 
                onPress={handleInfoPress}
                activeOpacity={0.8}
              >
                <Info size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  cameraLetterbox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  cameraContainer: {
    position: 'relative',
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  weightsIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseTopCard: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  recordButtonContainer: {
    marginBottom: SPACING.md,
    alignItems: 'center',
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  recordButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
  },
  pauseButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.text,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseButtonDisabled: {
    borderColor: COLORS.textSecondary,
    opacity: 0.5,
  },
  infoButton: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detectionLabel: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
    textAlign: 'center',
  },
  detectionExercise: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    textAlign: 'center',
  },
  metricsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    gap: SPACING.xl,
    marginBottom: SPACING.lg,
    marginLeft: SPACING.md,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  metricLabel: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  metricValue: {
    fontSize: 24,
    fontFamily: FONTS.mono.bold,
    color: COLORS.primary,
    minWidth: 30,
  },
  recordButtonActive: {
    borderColor: COLORS.primary,
  },
  recordButtonInnerActive: {
    backgroundColor: '#FF3B30',
  },
});

