import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Pressable, Dimensions, Platform, InteractionManager, Alert } from 'react-native';
import { RNMediapipe, switchCamera } from '@thinksys/react-native-mediapipe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RotateCw, Settings, Pause, Play, X } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { RootStackParamList, RecordStackParamList } from '../app/RootNavigator';
import { detectExercise, updateRepCount, Keypoint } from '../utils/poseAnalysis';
import {
  updateBarbellCurlState,
  initializeBarbellCurlState,
  BarbellCurlState,
  getRepCount,
  getCurrentFormScore,
  getCurrentFeedback,
} from '../utils/barbellCurlHeuristics';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { CameraSettingsModal } from '../components/ui/CameraSettingsModal';
import { onRepCompleted as ttsOnRepCompleted, onSetEnded as ttsOnSetEnded, onSetStarted as ttsOnSetStarted, resetCoachState as ttsResetCoach, stopCoach as ttsStopCoach } from '../services/ttsCoach';

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
  const { showFeedback, isTTSEnabled, showSkeletonOverlay } = useCameraSettings();

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
    repFeedback: [] as string[],
    duration: 0,
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  // Barbell curl specific state
  const barbellCurlStateRef = useRef<BarbellCurlState>(initializeBarbellCurlState());

  const category = route.params?.category ?? 'Weightlifting';
  const exerciseNameFromRoute = (route.params as any)?.exerciseName;
  const exerciseId = (route.params as any)?.exerciseId;
  const returnToCurrentWorkout = (route.params as any)?.returnToCurrentWorkout ?? false;
  const cameraSessionKey = (route.params as any)?.cameraSessionKey ?? 'default';


  // Settings popup (feedback + TTS toggles)
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);

  // Unmount camera before leaving so native layer can release it; avoids "Camera initialization failed" on next open
  const [cameraMounted, setCameraMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Mount camera when screen gains focus. Short delay lets previous native camera release.
  useFocusEffect(
    useCallback(() => {
      if (isClosing) return;
      setCameraMounted(false);
      const t = setTimeout(() => setCameraMounted(true), 150);
      return () => clearTimeout(t);
    }, [isClosing])
  );

  // Speak set-start message as soon as camera screen loads
  useFocusEffect(
    useCallback(() => {
      if (isTTSEnabled && exerciseNameFromRoute) {
        ttsResetCoach();
        ttsOnSetStarted(exerciseNameFromRoute).catch(() => {});
      }
    }, [isTTSEnabled, exerciseNameFromRoute])
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
    workoutUpdate?: { totalReps: number; formScore: number; repFeedback?: string };
  } | null>(null);
  const isRecordingRef = useRef(isRecording);
  const isPausedRef = useRef(isPaused);
  const lastCameraTapRef = useRef(0);
  // Synchronous accumulator for per-rep data — immune to InteractionManager deferral
  const accumulatedFormScoresRef = useRef<number[]>([]);
  const accumulatedRepFeedbackRef = useRef<string[]>([]);
  
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

  // Auto-clear feedback after 2 seconds (Barbell Curl and any green messages)
  useEffect(() => {
    if (!feedback || exerciseNameFromRoute !== 'Barbell Curl') return;
    const timer = setTimeout(() => setFeedback(null), 2000);
    return () => clearTimeout(timer);
  }, [feedback, exerciseNameFromRoute]);

  // Sync TTS enabled state to ref (for use in handleLandmark without stale closures)
  const isTTSEnabledRef = useRef(isTTSEnabled);
  useEffect(() => {
    isTTSEnabledRef.current = isTTSEnabled;
  }, [isTTSEnabled]);

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
  // Prefer worldLandmarks (3D body-centric coords) for view-angle-robust angle calculations.
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

      const useImage = !hasWorld && hasImage;
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
  }, []);

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
      if (pending.workoutUpdate) {
        setWorkoutData(prev => ({
          ...prev,
          totalReps: pending.workoutUpdate!.totalReps,
          formScores: [...prev.formScores, pending.workoutUpdate!.formScore],
          repFeedback: pending.workoutUpdate!.repFeedback
            ? [...prev.repFeedback, pending.workoutUpdate!.repFeedback]
            : prev.repFeedback,
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

    // Check if this is a Barbell Curl exercise (exercise-specific logic)
    if (exerciseNameFromRoute === 'Barbell Curl') {
      const newState = updateBarbellCurlState(keypoints, barbellCurlStateRef.current);
      barbellCurlStateRef.current = newState;

      // Extract data using helper functions
      const currentRepCount = getRepCount(newState);
      const currentScore = getCurrentFormScore(newState);
      const currentFeedback = getCurrentFeedback(newState);

      // Accumulate UI updates - don't setState here (blocks main thread)
      const pending = pendingUIStateRef.current ?? {};
      pending.repCount = currentRepCount;
      if (currentScore > 0) pending.formScore = currentScore;
      pending.feedback = currentFeedback;
      if (currentRepCount > accumulatedFormScoresRef.current.length) {
        pending.workoutUpdate = {
          totalReps: currentRepCount,
          formScore: currentScore,
          repFeedback: currentFeedback ?? 'Great rep!',
        };
        // Synchronous accumulation — immune to InteractionManager deferral race
        accumulatedFormScoresRef.current = [...accumulatedFormScoresRef.current, currentScore];
        accumulatedRepFeedbackRef.current = [...accumulatedRepFeedbackRef.current, currentFeedback ?? 'Great rep!'];

        // TTS coaching — fire-and-forget, does not block landmark processing
        if (isTTSEnabledRef.current) {
          const repMessages = newState.lastRepResult?.messages ?? [];
          const repScore = newState.lastRepResult?.score ?? 100;
          ttsOnRepCompleted(repMessages, repScore).catch(() => {});
        }
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
        if (repUpdate.repCount > accumulatedFormScoresRef.current.length) {
          const formScore = repUpdate.formScore;
          const feedbackMsg = formScore >= 90 ? 'Great rep!' : 'Good rep.';

          setRepCount(repUpdate.repCount);
          setCurrentFormScore(formScore);

          // Update workout data with functional update to avoid stale closures
          setWorkoutData(prev => ({
            ...prev,
            totalReps: prev.totalReps + 1,
            formScores: [...prev.formScores, formScore],
            repFeedback: [...prev.repFeedback, feedbackMsg],
          }));
          // Synchronous accumulation — immune to InteractionManager deferral race
          accumulatedFormScoresRef.current = [...accumulatedFormScoresRef.current, formScore];
          accumulatedRepFeedbackRef.current = [...accumulatedRepFeedbackRef.current, feedbackMsg];
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
      // Read per-rep data from synchronous refs (immune to InteractionManager deferral)
      pendingUIStateRef.current = null;
      const totalReps = accumulatedFormScoresRef.current.length;

      setIsRecording(false);

      const formScores = accumulatedFormScoresRef.current;
      const repFeedback = accumulatedRepFeedbackRef.current;
      // Weighted average: bad reps weigh up to 3× more than perfect reps
      let avgFormScore = 0;
      if (formScores.length > 0) {
        let totalWeight = 0;
        let weightedSum = 0;
        for (const s of formScores) {
          const w = 1 + (100 - s) / 50; // range [1, 3]
          totalWeight += w;
          weightedSum += s * w;
        }
        avgFormScore = Math.round(weightedSum / totalWeight);
      }

      if (returnToCurrentWorkout && exerciseNameFromRoute && exerciseId) {
        const newSet = {
          exerciseName: exerciseNameFromRoute,
          reps: totalReps,
          weight: 0,
          formScore: avgFormScore,
          repFeedback: repFeedback.length > 0 ? repFeedback : undefined,
          repFormScores: formScores.length > 0 ? formScores : undefined,
        };
        addSetToExercise(exerciseId, newSet);
        // TTS: speak brief set summary
        if (isTTSEnabledRef.current) {
          ttsOnSetEnded(totalReps, avgFormScore).catch(() => {});
        }
        // Unmount camera first so native layer releases it; prevents "Camera initialization failed" on next open
        setIsClosing(true);
        setCameraMounted(false);
        setTimeout(() => {
          (navigation as any).navigate('CurrentWorkout', { showWeightFor: { exerciseId } });
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
        repFeedback: [],
        duration: 0,
      });
      accumulatedFormScoresRef.current = [];
      accumulatedRepFeedbackRef.current = [];
      ttsResetCoach();
    }
  }, [isRecording, category, exerciseNameFromRoute, exerciseId, returnToCurrentWorkout, navigation, addSetToExercise]);

  const handlePausePress = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  const handleCameraFlip = useCallback(() => {
    switchCamera();
  }, []);

  const handleCameraDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastCameraTapRef.current < 350) {
      handleCameraFlip();
      lastCameraTapRef.current = 0;
    } else {
      lastCameraTapRef.current = now;
    }
  }, [handleCameraFlip]);

  const handleDiscardSetPress = useCallback(() => {
    Alert.alert(
      'Discard set?',
      'Are you sure you want to discard this set? Your reps will not be saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, discard',
          style: 'destructive',
          onPress: () => {
            setIsClosing(true);
            setCameraMounted(false);
            setTimeout(() => {
              (navigation as any).navigate('CurrentWorkout');
            }, 450);
          },
        },
      ]
    );
  }, [navigation]);

  // Memoize MediaPipe props – 3:4 portrait (taller than wide)
  // Skeleton overlay is visual only; pose detection (onLandmark) is unaffected
  const mediapipeProps = useMemo(() => ({
    width: cameraDisplayWidth,
    height: cameraDisplayHeight,
    face: showSkeletonOverlay,
    leftArm: showSkeletonOverlay,
    rightArm: showSkeletonOverlay,
    torso: showSkeletonOverlay,
    leftLeg: showSkeletonOverlay,
    rightLeg: showSkeletonOverlay,
    leftWrist: showSkeletonOverlay,
    rightWrist: showSkeletonOverlay,
    leftAnkle: showSkeletonOverlay,
    rightAnkle: showSkeletonOverlay,
    frameLimit: 20,
  }), [showSkeletonOverlay]);

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
      <Pressable
        style={[
          styles.cameraLetterbox,
          { paddingTop: topBarHeight, paddingBottom: bottomBarHeight },
        ]}
        onPress={handleCameraDoubleTap}
      >
        <View style={[styles.cameraContainer, { width: cameraDisplayWidth, height: cameraDisplayHeight }]}>
          {showCamera && (
            <RNMediapipe
              {...mediapipeProps}
              onLandmark={handleLandmark}
            />
          )}
        </View>
      </Pressable>

      {/* Overlay UI */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top Bar */}
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.discardButton}
            onPress={handleDiscardSetPress}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Discard set"
          >
            <X size={24} color={COLORS.text} strokeWidth={2.5} />
          </TouchableOpacity>
          <View style={styles.exerciseTopCard}>
            <Text style={styles.detectionExercise} numberOfLines={1}>
              {displayValues.exerciseDisplayName}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => setSettingsModalVisible(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Camera settings"
          >
            <Settings size={24} color={COLORS.text} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* Feedback Display - Speech bubble below exercise name */}
        {feedback && showFeedback && (
          <View style={styles.feedbackContainer}>
            <View style={styles.feedbackBubble}>
              <Text style={styles.feedbackText}>{feedback}</Text>
              <View style={styles.feedbackTail} />
            </View>
          </View>
        )}

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

          {/* Control Buttons: Pause | Record | Flip camera */}
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
                style={styles.flipCameraButton}
                onPress={handleCameraFlip}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
              >
                <RotateCw size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <CameraSettingsModal
        visible={settingsModalVisible}
        onClose={() => setSettingsModalVisible(false)}
        onTTSDisable={ttsStopCoach}
      />
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
  discardButton: {
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
  settingsButton: {
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
  flipCameraButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.text,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
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
  feedbackBubble: {
    backgroundColor: '#000000',
    borderRadius: 16,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    paddingBottom: SPACING.md + 8,
    maxWidth: '90%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  feedbackTail: {
    position: 'absolute',
    bottom: -8,
    left: '50%',
    marginLeft: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#000000',
  },
  feedbackText: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
    textAlign: 'center',
  },
});

