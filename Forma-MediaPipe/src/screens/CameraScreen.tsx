import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Dimensions, Platform, InteractionManager } from 'react-native';
import { RNMediapipe, switchCamera } from '@thinksys/react-native-mediapipe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlipHorizontal, Pause, Play, Info, Dumbbell } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { RootStackParamList, RecordStackParamList } from '../app/RootNavigator';
import { detectExercise, updateRepCount, Keypoint } from '../utils/poseAnalysis';
import { updateBarbellCurlState, initializeBarbellCurlState, BarbellCurlState } from '../utils/barbellCurlAnalysis';
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
  const { addSetToExercise } = useCurrentWorkout();
  
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentExercise, setCurrentExercise] = useState<string | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [currentFormScore, setCurrentFormScore] = useState<number | null>(null);
  const [exercisePhase, setExercisePhase] = useState<'up' | 'down' | 'idle'>('idle');
  const [workoutStartTime, setWorkoutStartTime] = useState<Date | null>(null);
  const [workoutData, setWorkoutData] = useState({
    totalReps: 0,
    formScores: [] as number[],
    duration: 0,
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  // Joint angles and positions for skeleton overlay (Barbell Curl)
  const [jointOverlayData, setJointOverlayData] = useState<{
    angles: {
      leftElbow: number | null;
      rightElbow: number | null;
      leftShoulder: number | null;
      rightShoulder: number | null;
      leftHip: number | null;
      rightHip: number | null;
      leftKnee: number | null;
      rightKnee: number | null;
    };
    positions: {
      leftElbow: { x: number; y: number } | null;
      rightElbow: { x: number; y: number } | null;
      leftShoulder: { x: number; y: number } | null;
      rightShoulder: { x: number; y: number } | null;
      leftHip: { x: number; y: number } | null;
      rightHip: { x: number; y: number } | null;
      leftKnee: { x: number; y: number } | null;
      rightKnee: { x: number; y: number } | null;
    };
  }>({
    angles: { leftElbow: null, rightElbow: null, leftShoulder: null, rightShoulder: null, leftHip: null, rightHip: null, leftKnee: null, rightKnee: null },
    positions: { leftElbow: null, rightElbow: null, leftShoulder: null, rightShoulder: null, leftHip: null, rightHip: null, leftKnee: null, rightKnee: null },
  });

  // Barbell curl specific state
  const barbellCurlStateRef = useRef<BarbellCurlState>(initializeBarbellCurlState());

  const category = route.params?.category ?? 'Weightlifting';
  const exerciseNameFromRoute = (route.params as any)?.exerciseName;
  const exerciseId = (route.params as any)?.exerciseId;
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
  const lastUIUpdateTimeRef = useRef(0);
  const pendingUIStateRef = useRef<{
    repCount?: number;
    formScore?: number;
    feedback?: string | null;
    jointOverlayData?: {
      angles: { leftElbow: number | null; rightElbow: number | null; leftShoulder: number | null; rightShoulder: number | null; leftHip: number | null; rightHip: number | null; leftKnee: number | null; rightKnee: number | null };
      positions: Record<string, { x: number; y: number } | null>;
    };
    workoutUpdate?: { totalReps: number; formScore: number };
  } | null>(null);
  const isRecordingRef = useRef(isRecording);
  const isPausedRef = useRef(isPaused);
  
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

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

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

  // Convert MediaPipe landmark data to our Keypoint format.
  // For Barbell Curl: use image coords so 2D elbow angle matches the visible bend on screen.
  // Otherwise: prefer worldLandmarks (3D) for consistent scale.
  const convertLandmarksToKeypoints = useCallback((landmarkData: any): Keypoint[] | null => {
    try {
      let parsedData = landmarkData;
      if (typeof landmarkData === 'string') {
        parsedData = JSON.parse(landmarkData);
      }

      const worldLandmarksArray = parsedData?.worldLandmarks;
      const imageLandmarksArray = parsedData?.landmarks || parsedData;

      const hasWorld =
        Array.isArray(worldLandmarksArray) &&
        worldLandmarksArray.length >= 33 &&
        typeof worldLandmarksArray[0]?.x === 'number';
      const hasImage = Array.isArray(imageLandmarksArray) && imageLandmarksArray.length >= 33;

      // Barbell Curl: use image coords for elbow angle (2D xy = visible bend on camera)
      const useImage = exerciseNameFromRoute === 'Barbell Curl' && hasImage;
      const landmarksArray = useImage
        ? imageLandmarksArray.slice(0, 33)
        : hasWorld
          ? worldLandmarksArray.slice(0, 33)
          : hasImage
            ? imageLandmarksArray.slice(0, 33)
            : null;

      if (!landmarksArray) {
        return null;
      }

      const keypoints: Keypoint[] = landmarksArray.map((landmark: any, index: number) => ({
        name: MEDIAPIPE_LANDMARK_NAMES[index] || `landmark_${index}`,
        x: landmark.x ?? 0,
        y: landmark.y ?? 0,
        z: typeof landmark.z === 'number' ? landmark.z : 0,
        score: landmark.visibility !== undefined ? landmark.visibility : 1.0,
      }));

      return keypoints;
    } catch {
      return null;
    }
  }, [exerciseNameFromRoute]);

  // Flush pending UI updates to React state (throttled to avoid blocking main thread)
  const UI_UPDATE_INTERVAL_MS = 100; // Max 10 UI updates/sec - keeps buttons responsive
  const ANALYSIS_THROTTLE_MS = 33;   // ~30fps analysis - balance between accuracy and perf

  const flushPendingUI = useCallback(() => {
    const pending = pendingUIStateRef.current;
    if (!pending) return;
    pendingUIStateRef.current = null;

    // Defer state updates until after interactions (button presses) complete
    InteractionManager.runAfterInteractions(() => {
      if (pending.repCount !== undefined) setRepCount(pending.repCount);
      if (pending.formScore !== undefined) setCurrentFormScore(pending.formScore);
      if (pending.feedback !== undefined) setFeedback(pending.feedback);
      if (pending.jointOverlayData) setJointOverlayData(pending.jointOverlayData);
      if (pending.workoutUpdate) {
        setWorkoutData(prev => ({
          ...prev,
          totalReps: pending.workoutUpdate!.totalReps,
          formScores: [...prev.formScores, pending.workoutUpdate!.formScore],
        }));
      }
    });
  }, []);

  // Handle landmark data from MediaPipe - throttle analysis, batch UI updates
  const handleLandmark = useCallback((data: any) => {
    if (!isRecordingRef.current) return;
    if (isPausedRef.current) return;

    const now = Date.now();

    // Throttle analysis (not every frame - reduces JS thread load)
    if (now - lastDetectionTimeRef.current < ANALYSIS_THROTTLE_MS) {
      return;
    }
    lastDetectionTimeRef.current = now;

    const keypoints = convertLandmarksToKeypoints(data);
    if (!keypoints || keypoints.length === 0) return;

    // Extract image landmark positions for overlay (normalized 0-1) - needed for screen placement
    let imagePositions: Record<string, { x: number; y: number } | null> = {};
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const imgLandmarks = parsed?.landmarks;
      if (Array.isArray(imgLandmarks) && imgLandmarks.length >= 33) {
        const idx = (name: string) => MEDIAPIPE_LANDMARK_NAMES.indexOf(name);
        const pos = (i: number) => imgLandmarks[i] && typeof imgLandmarks[i].x === 'number'
          ? { x: imgLandmarks[i].x, y: imgLandmarks[i].y }
          : null;
        imagePositions = {
          leftElbow: pos(idx('left_elbow')),
          rightElbow: pos(idx('right_elbow')),
          leftShoulder: pos(idx('left_shoulder')),
          rightShoulder: pos(idx('right_shoulder')),
          leftHip: pos(idx('left_hip')),
          rightHip: pos(idx('right_hip')),
          leftKnee: pos(idx('left_knee')),
          rightKnee: pos(idx('right_knee')),
        };
      }
    } catch {
      // Ignore position parse errors
    }

    // Check if this is a Barbell Curl exercise (exercise-specific logic)
    if (exerciseNameFromRoute === 'Barbell Curl') {
      const newState = updateBarbellCurlState(keypoints, barbellCurlStateRef.current);
      barbellCurlStateRef.current = newState;

      // Accumulate UI updates - don't setState here (blocks main thread)
      const pending = pendingUIStateRef.current ?? {};
      pending.repCount = newState.repCount;
      if (newState.formScore > 0) pending.formScore = newState.formScore;
      pending.feedback = newState.feedback ?? null;
      pending.jointOverlayData = {
        angles: {
          leftElbow: newState.leftElbowAngle,
          rightElbow: newState.rightElbowAngle,
          leftShoulder: newState.leftShoulderAngle,
          rightShoulder: newState.rightShoulderAngle,
          leftHip: newState.leftHipAngle,
          rightHip: newState.rightHipAngle,
          leftKnee: newState.leftKneeAngle,
          rightKnee: newState.rightKneeAngle,
        },
        positions: imagePositions,
      };
      if (newState.repCount > repCountRef.current) {
        pending.workoutUpdate = {
          totalReps: newState.repCount,
          formScore: newState.formScore,
        };
      }
      pendingUIStateRef.current = pending;

      // Flush immediately when rep completes; otherwise throttle to keep buttons responsive
      const repJustCompleted = newState.repCount > repCountRef.current;
      const throttleElapsed = now - lastUIUpdateTimeRef.current >= UI_UPDATE_INTERVAL_MS;
      if (repJustCompleted || throttleElapsed) {
        lastUIUpdateTimeRef.current = now;
        flushPendingUI();
      }
    } else {
      // Generic exercise detection - also throttled
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
          
          setRepCount(repUpdate.repCount);
          setCurrentFormScore(formScore);
          
          // Update workout data with functional update to avoid stale closures
          setWorkoutData(prev => ({
            ...prev,
            totalReps: prev.totalReps + 1,
            formScores: [...prev.formScores, formScore],
          }));
        }
      } else if (currentExerciseRef.current !== null) {
        // No exercise detected - reset
        setCurrentExercise(null);
        setExercisePhase('idle');
      }
    }
  }, [convertLandmarksToKeypoints, exerciseNameFromRoute, flushPendingUI]);

  // Memoize button handlers to prevent recreating on every render
  const workoutDataRef = useRef(workoutData);
  useEffect(() => {
    workoutDataRef.current = workoutData;
  }, [workoutData]);

  const handleRecordPress = useCallback(() => {
    if (isRecording) {
      // Flush pending UI synchronously for stop - use latest from ref/pending for accuracy
      const pending = pendingUIStateRef.current;
      let totalReps = repCountRef.current;
      let formScores = workoutDataRef.current.formScores;
      if (pending?.workoutUpdate) {
        totalReps = pending.workoutUpdate.totalReps;
        formScores = [...formScores, pending.workoutUpdate.formScore];
      }
      pendingUIStateRef.current = null;

      setIsRecording(false);

      const avgFormScore = formScores.length > 0
        ? Math.round(formScores.reduce((a, b) => a + b, 0) / formScores.length)
        : 0;

      if (returnToCurrentWorkout && exerciseNameFromRoute && exerciseId) {
        const newSet = {
          exerciseName: exerciseNameFromRoute,
          reps: totalReps,
          weight: 0,
          formScore: avgFormScore,
        };
        addSetToExercise(exerciseId, newSet);
        // Unmount camera first so native layer releases it; prevents "Camera initialization failed" on next open
        setIsClosing(true);
        setCameraMounted(false);
        setTimeout(() => {
          (navigation as any).navigate('CurrentWorkout');
        }, 450);
      } else {
        // Original flow: navigate to SaveWorkout
        const minutes = Math.floor(workoutDataRef.current.duration / 60);
        const seconds = workoutDataRef.current.duration % 60;
        const durationString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const workoutDataToSave = {
          category,
          duration: durationString,
          totalReps,
          avgFormScore,
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
      setIsPaused(false);
      setFeedback(null);
      // Reset barbell curl state if starting a barbell curl
      if (exerciseNameFromRoute === 'Barbell Curl') {
        barbellCurlStateRef.current = initializeBarbellCurlState();
      }
      setWorkoutData({
        totalReps: 0,
        formScores: [],
        duration: 0,
      });
    }
  }, [isRecording, category, exerciseNameFromRoute, exerciseId, returnToCurrentWorkout, navigation, addSetToExercise]);

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
  // frameLimit: 20 fps on both iOS and Android for lower latency (matches platforms)
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
    frameLimit: 20,
  }), []);

  // Memoize display values to avoid recalculation
  const displayValues = useMemo(() => {
    const formDisplay = repCount > 0 && currentFormScore !== null
      ? Number(currentFormScore).toFixed(1)
      : '-';
    const values = {
      reps: repCount > 0 ? repCount : '-',
      form: formDisplay,
      exerciseDisplayName: (exerciseNameFromRoute || currentExercise || 'NO EXERCISE DETECTED').toUpperCase(),
    };
    return values;
  }, [repCount, currentFormScore, currentExercise, exerciseNameFromRoute]);

  const showCamera = cameraMounted && !isClosing;


  const topBarContentHeight = insets.top + 44;
  const gapAboveCamera = SPACING.xl;
  const topBarHeight = topBarContentHeight + gapAboveCamera;
  const bottomBarHeight = insets.bottom + SPACING.lg + 40 + SPACING.lg + 80 + SPACING.md;

  return (
    <View style={styles.container}>
      {/* Camera fixed below top bar (same gap); extra space goes below for metrics */}
      <View style={[
        styles.cameraLetterbox,
        { paddingTop: topBarHeight, paddingBottom: bottomBarHeight },
      ]}>
        <View style={[styles.cameraContainer, { width: cameraDisplayWidth, height: cameraDisplayHeight }]}>
          {showCamera && (
            <RNMediapipe
              {...mediapipeProps}
              onLandmark={handleLandmark}
            />
          )}
        </View>
      </View>

      {/* Overlay UI */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top Bar */}
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <View style={styles.weightsIconContainer}>
            <Dumbbell size={24} color={COLORS.text} />
          </View>
          <View style={styles.exerciseTopCard}>
            <Text style={styles.detectionExercise} numberOfLines={1}>
              {displayValues.exerciseDisplayName}
            </Text>
          </View>
          <TouchableOpacity style={styles.flipButton} onPress={handleCameraFlip}>
            <FlipHorizontal size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* Feedback Display - Appears below exercise name */}
        {feedback && (
          <View style={styles.feedbackContainer}>
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackText}>{feedback}</Text>
            </View>
          </View>
        )}

        {/* Joint angle labels on skeleton - only when recording Barbell Curl */}
        {isRecording && exerciseNameFromRoute === 'Barbell Curl' && (() => {
          const cameraTop = topBarHeight + (SCREEN_HEIGHT - topBarHeight - bottomBarHeight - cameraDisplayHeight) / 2;
          const cameraLeft = (SCREEN_WIDTH - cameraDisplayWidth) / 2;
          const joints: { key: keyof typeof jointOverlayData.angles; posKey: keyof typeof jointOverlayData.positions }[] = [
            { key: 'leftElbow', posKey: 'leftElbow' },
            { key: 'rightElbow', posKey: 'rightElbow' },
            { key: 'leftShoulder', posKey: 'leftShoulder' },
            { key: 'rightShoulder', posKey: 'rightShoulder' },
            { key: 'leftHip', posKey: 'leftHip' },
            { key: 'rightHip', posKey: 'rightHip' },
            { key: 'leftKnee', posKey: 'leftKnee' },
            { key: 'rightKnee', posKey: 'rightKnee' },
          ];
          return (
            <View
              style={[
                styles.jointOverlayContainer,
                {
                  left: cameraLeft,
                  top: cameraTop,
                  width: cameraDisplayWidth,
                  height: cameraDisplayHeight,
                },
              ]}
              pointerEvents="none"
            >
              {joints.map(({ key, posKey }) => {
                const angle = jointOverlayData.angles[key];
                const pos = jointOverlayData.positions[posKey];
                if (!pos || angle === null) return null;
                return (
                  <View
                    key={key}
                    style={[
                      styles.jointLabel,
                      {
                        left: pos.x * cameraDisplayWidth - 24,
                        top: pos.y * cameraDisplayHeight - 10,
                      },
                    ]}
                  >
                    <Text style={styles.jointLabelText}>
                      {angle.toFixed(0)}°
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}

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
    paddingHorizontal: SPACING.screenHorizontal,
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
    paddingHorizontal: SPACING.screenHorizontal,
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
  detectionExercise: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    fontSize: 18,
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
  feedbackContainer: {
    position: 'absolute',
    top: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    zIndex: 10,
  },
  feedbackCard: {
    backgroundColor: 'rgba(32, 215, 96, 0.95)',
    borderRadius: 12,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  feedbackText: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    textAlign: 'center',
  },
  jointOverlayContainer: {
    position: 'absolute',
    zIndex: 5,
  },
  jointLabel: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 48,
    alignItems: 'center',
  },
  jointLabelText: {
    fontSize: 11,
    fontFamily: FONTS.mono.regular,
    color: COLORS.primary,
  },
});

