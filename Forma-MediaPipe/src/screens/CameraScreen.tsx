import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Pressable, Dimensions, Platform, InteractionManager, Alert } from 'react-native';
import { RNMediapipe, switchCamera } from '@thinksys/react-native-mediapipe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Settings, X } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import CameraSwitchIcon from '../components/icons/CameraSwitchIcon';
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
  getBarbellCurlDebugInfo,
} from '../utils/barbellCurlHeuristics';
import {
  updatePushupState,
  initializePushupState,
  PushupState,
  getPushupRepCount,
  getPushupFormScore,
  getPushupFeedback,
  getPushupDebugInfo,
  PushupDebugInfo,
} from '../utils/pushupHeuristics';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { CameraSettingsModal } from '../components/ui/CameraSettingsModal';
import { onRepCompleted as ttsOnRepCompleted, onSetEnded as ttsOnSetEnded, onSetStarted as ttsOnSetStarted, resetCoachState as ttsResetCoach, stopCoach as ttsStopCoach } from '../services/ttsCoach';

/** Exercises with dedicated heuristics (FSM-based form analysis) */
const EXERCISES_WITH_HEURISTICS = new Set(['Barbell Curl', 'Push-Up']);

const MAX_FEED_ITEMS = 4;
type FeedbackFeedItem = { id: number; text: string };

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 9:16 portrait viewfinder, full width, starts at top, rounded corners
const CAMERA_ASPECT_WIDTH = 9;
const CAMERA_ASPECT_HEIGHT = 16;
const CAMERA_BORDER_RADIUS = 20;

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
  const { showFeedback, isTTSEnabled, showSkeletonOverlay, debugMode } = useCameraSettings();

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
  const [feedbackFeed, setFeedbackFeed] = useState<FeedbackFeedItem[]>([]);
  const feedbackIdRef = useRef(0);
  const [barbellCurlDebug, setBarbellCurlDebug] = useState<ReturnType<typeof getBarbellCurlDebugInfo> | null>(null);
  const [pushupDebug, setPushupDebug] = useState<PushupDebugInfo | null>(null);

  // Exercise-specific state refs
  const barbellCurlStateRef = useRef<BarbellCurlState>(initializeBarbellCurlState());
  const pushupStateRef = useRef<PushupState>(initializePushupState());

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

  // Speak set-start message as soon as camera screen loads (debug mode overrides TTS off)
  useFocusEffect(
    useCallback(() => {
      if (!debugMode && isTTSEnabled && exerciseNameFromRoute) {
        ttsResetCoach();
        ttsOnSetStarted(exerciseNameFromRoute).catch(() => {});
      }
    }, [debugMode, isTTSEnabled, exerciseNameFromRoute])
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
    barbellCurlDebug?: ReturnType<typeof getBarbellCurlDebugInfo> | null;
    pushupDebug?: PushupDebugInfo | null;
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

  // Sync TTS enabled state to ref (for use in handleLandmark without stale closures). Debug mode overrides TTS off.
  const isTTSEnabledRef = useRef(isTTSEnabled);
  const debugModeRef = useRef(debugMode);
  useEffect(() => {
    isTTSEnabledRef.current = debugMode ? false : isTTSEnabled;
  }, [isTTSEnabled, debugMode]);
  useEffect(() => {
    debugModeRef.current = debugMode;
  }, [debugMode]);

  // Clear other exercise's debug when route exercise changes
  useEffect(() => {
    if (exerciseNameFromRoute !== 'Barbell Curl') setBarbellCurlDebug(null);
    if (exerciseNameFromRoute !== 'Push-Up') setPushupDebug(null);
  }, [exerciseNameFromRoute]);

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
      if (pending.barbellCurlDebug !== undefined) setBarbellCurlDebug(pending.barbellCurlDebug);
      if (pending.pushupDebug !== undefined) setPushupDebug(pending.pushupDebug);
      if (pending.workoutUpdate) {
        const repFeedback = pending.workoutUpdate.repFeedback?.trim() ?? '';
        if (repFeedback !== '') {
          setFeedbackFeed(prev => {
            const id = feedbackIdRef.current++;
            return [...prev.slice(-(MAX_FEED_ITEMS - 1)), { id, text: repFeedback }];
          });
        }
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

  // Handle landmark data from MediaPipe - throttle analysis, batch UI updates. Run when recording or when debug mode (to show angles).
  const handleLandmark = useCallback((data: any) => {
    if (!isRecordingRef.current && !debugModeRef.current) return;
    if (isPausedRef.current && !debugModeRef.current) return;

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
      pending.barbellCurlDebug = getBarbellCurlDebugInfo(newState);
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

      // Flush immediately when rep completes; otherwise throttle. In debug mode also flush on throttle so angles update.
      const repJustCompleted = newState.repCount > repCountRef.current;
      const throttleElapsed = now - lastUIUpdateTimeRef.current >= UI_UPDATE_INTERVAL_MS;
      if (repJustCompleted || throttleElapsed) {
        lastUIUpdateTimeRef.current = now;
        flushPendingUI();
      }
    } else if (exerciseNameFromRoute === 'Push-Up') {
      const newState = updatePushupState(keypoints, pushupStateRef.current);
      pushupStateRef.current = newState;

      const currentRepCount = getPushupRepCount(newState);
      const currentScore = getPushupFormScore(newState);
      const currentFeedback = getPushupFeedback(newState);
      const pushupDebugInfo = getPushupDebugInfo(newState);

      const pending = pendingUIStateRef.current ?? {};
      pending.repCount = currentRepCount;
      if (currentScore > 0) pending.formScore = currentScore;
      pending.feedback = currentFeedback;
      pending.barbellCurlDebug = null;
      pending.pushupDebug = pushupDebugInfo;
      if (currentRepCount > repCountRef.current) {
        pending.workoutUpdate = {
          totalReps: currentRepCount,
          formScore: currentScore,
          repFeedback: currentFeedback ?? 'Great rep!',
        };
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
      setBarbellCurlDebug(null);
      setPushupDebug(null);

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
        const durationSeconds = workoutDataRef.current.duration;
        const newSet = {
          exerciseName: exerciseNameFromRoute,
          reps: totalReps,
          weight: 0,
          formScore: avgFormScore,
          durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
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
      setFeedbackFeed([]);
      setBarbellCurlDebug(null);
      // Reset exercise-specific state
      if (exerciseNameFromRoute === 'Barbell Curl') {
        barbellCurlStateRef.current = initializeBarbellCurlState();
      } else if (exerciseNameFromRoute === 'Push-Up') {
        pushupStateRef.current = initializePushupState();
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

  // Layout: top bar, then 9:16 camera, then control strip. Camera and control strip meet at the same line (control starts where camera ends).
  const topInset = insets.top + 6;
  const topBarHeight = topInset + 48;
  const cameraDisplayWidth = SCREEN_WIDTH;
  const cameraDisplayHeight = (SCREEN_WIDTH * CAMERA_ASPECT_HEIGHT) / CAMERA_ASPECT_WIDTH;
  const controlStripApproxHeight = 165 + insets.bottom;

  // Memoize MediaPipe props – 9:16 portrait viewfinder
  const effectiveShowSkeleton = debugMode || showSkeletonOverlay;
  const mediapipeProps = useMemo(() => ({
    width: cameraDisplayWidth,
    height: cameraDisplayHeight,
    face: effectiveShowSkeleton,
    leftArm: effectiveShowSkeleton,
    rightArm: effectiveShowSkeleton,
    torso: effectiveShowSkeleton,
    leftLeg: effectiveShowSkeleton,
    rightLeg: effectiveShowSkeleton,
    leftWrist: effectiveShowSkeleton,
    rightWrist: effectiveShowSkeleton,
    leftAnkle: effectiveShowSkeleton,
    rightAnkle: effectiveShowSkeleton,
    frameLimit: 20,
  }), [effectiveShowSkeleton, cameraDisplayWidth, cameraDisplayHeight]);

  // Memoize display values to avoid recalculation
  const displayValues = useMemo(() => {
    const formDisplay = repCount > 0 && currentFormScore !== null
      ? Number(currentFormScore).toFixed(1)
      : '-';
    const totalSeconds = workoutData.duration;
    const timerDisplay = isRecording
      ? `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`
      : '-';
    const values = {
      reps: repCount > 0 ? repCount : '-',
      form: formDisplay,
      timer: timerDisplay,
      exerciseDisplayName: (exerciseNameFromRoute || currentExercise || 'NO EXERCISE DETECTED').toUpperCase(),
    };
    return values;
  }, [repCount, currentFormScore, currentExercise, exerciseNameFromRoute, workoutData.duration, isRecording]);

  const showCamera = cameraMounted && !isClosing;

  return (
    <View style={styles.container}>
      {/* Top bar — above camera, not overlapping */}
      <View style={[styles.topBarSection, { paddingTop: topInset, height: topBarHeight }]}>
        <TouchableOpacity
          style={styles.discardButton}
          onPress={handleDiscardSetPress}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Discard set"
        >
          <X size={20} color={COLORS.text} strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={styles.exerciseTopCardWrap}>
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
          <Settings size={20} color={COLORS.text} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* 9:16 camera with control strip overlaying its bottom — no gap, control starts where camera starts (same container) */}
      <View style={styles.cameraArea}>
        <View style={[styles.cameraSection, { height: cameraDisplayHeight }]}>
          <Pressable
            style={styles.cameraFill}
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

          {/* Overlay UI over camera (feedback, debug) */}
          <View style={[styles.overlay, { height: cameraDisplayHeight }]}>
        {/* Feedback Display - Speech bubble below exercise name. Debug: only last message. */}
        {(showFeedback || debugMode) && (() => {
          const filtered = feedbackFeed.filter(item => (item.text || '').trim() !== '');
          const items = debugMode ? filtered.slice(-1) : filtered.slice(-4);
          if (items.length === 0) return null;
          return (
            <View style={[styles.feedbackFeedContainer, { bottom: controlStripApproxHeight + SPACING.xs }]}>
              {items.map((item, index) => {
                // Opacity by position from newest: 0th = 0.9, 1st back = 0.67, 2nd = 0.43, 3rd+ = 0.2
                const positionFromNewest = items.length - 1 - index;
                const t = positionFromNewest >= 3 ? 0 : 1 - positionFromNewest / 3;
                const opacity = 0.2 + 0.7 * t;
                return (
                  <View
                    key={item.id}
                    style={[styles.feedbackFeedItem, { opacity }]}
                  >
                    <Text style={styles.feedbackFeedText} numberOfLines={2}>
                      {item.text}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* Barbell Curl Debug - All angles used in form analysis. Visible only when debug mode is on. */}
        {exerciseNameFromRoute === 'Barbell Curl' &&
          debugMode &&
          barbellCurlDebug && (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Barbell Curl — Form Angles</Text>
                <Text style={styles.torsoDebugText}>
                  Elbow L: {barbellCurlDebug.current.leftElbow != null ? barbellCurlDebug.current.leftElbow.toFixed(1) + '°' : '–'} | R: {barbellCurlDebug.current.rightElbow != null ? barbellCurlDebug.current.rightElbow.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Shoulder L: {barbellCurlDebug.current.leftShoulder != null ? barbellCurlDebug.current.leftShoulder.toFixed(1) + '°' : '–'} | R: {barbellCurlDebug.current.rightShoulder != null ? barbellCurlDebug.current.rightShoulder.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso mid: {barbellCurlDebug.current.torso != null ? barbellCurlDebug.current.torso.toFixed(1) + '°' : '–'} | L: {barbellCurlDebug.current.leftTorso != null ? barbellCurlDebug.current.leftTorso.toFixed(1) + '°' : '–'} | R: {barbellCurlDebug.current.rightTorso != null ? barbellCurlDebug.current.rightTorso.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Wrist L: {barbellCurlDebug.current.leftWrist != null ? barbellCurlDebug.current.leftWrist.toFixed(1) + '°' : '–'} | R: {barbellCurlDebug.current.rightWrist != null ? barbellCurlDebug.current.rightWrist.toFixed(1) + '°' : '–'}
                </Text>
                {barbellCurlDebug.repDelta && (
                  <>
                    <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>Δ this rep:</Text>
                    <Text style={styles.torsoDebugText}>
                      Elbow L/R: {barbellCurlDebug.repDelta.leftElbow != null ? barbellCurlDebug.repDelta.leftElbow.toFixed(1) : '–'}° / {barbellCurlDebug.repDelta.rightElbow != null ? barbellCurlDebug.repDelta.rightElbow.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Shoulder L/R: {barbellCurlDebug.repDelta.leftShoulder != null ? barbellCurlDebug.repDelta.leftShoulder.toFixed(1) : '–'}° / {barbellCurlDebug.repDelta.rightShoulder != null ? barbellCurlDebug.repDelta.rightShoulder.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Torso mid/L/R: {barbellCurlDebug.repDelta.torso != null ? barbellCurlDebug.repDelta.torso.toFixed(1) : '–'}° / {barbellCurlDebug.repDelta.leftTorso != null ? barbellCurlDebug.repDelta.leftTorso.toFixed(1) : '–'}° / {barbellCurlDebug.repDelta.rightTorso != null ? barbellCurlDebug.repDelta.rightTorso.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Wrist L/R: {barbellCurlDebug.repDelta.leftWrist != null ? barbellCurlDebug.repDelta.leftWrist.toFixed(1) : '–'}° / {barbellCurlDebug.repDelta.rightWrist != null ? barbellCurlDebug.repDelta.rightWrist.toFixed(1) : '–'}°
                    </Text>
                  </>
                )}
                <Text style={styles.torsoDebugText}>
                  View: {barbellCurlDebug.viewAngle != null ? barbellCurlDebug.viewAngle.toFixed(0) : '–'}° ({barbellCurlDebug.viewZone})
                </Text>
                <Text style={styles.torsoDebugText}>
                  Reach L/R: {barbellCurlDebug.reachLeft != null ? (barbellCurlDebug.reachLeft * 100).toFixed(0) + '%' : '–'} / {barbellCurlDebug.reachRight != null ? (barbellCurlDebug.reachRight * 100).toFixed(0) + '%' : '–'}
                </Text>
                <Text style={styles.torsoDebugHint}>Torso warn &gt;12° fail &gt;22° | Shoulder warn 45° fail 65° | Wrist ~180°</Text>
              </View>
            </View>
          )}

        {/* Pushup Debug - Shows all angles, FSM phase, and rep window data. Visible only when debug mode is on. */}
        {exerciseNameFromRoute === 'Push-Up' &&
          debugMode &&
          pushupDebug && (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Push-Up Debug</Text>
                <Text style={styles.torsoDebugText}>
                  Phase: {pushupDebug.phase} | Side: {pushupDebug.side}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Elbow: {pushupDebug.elbow != null ? pushupDebug.elbow.toFixed(1) + '°' : '–'}
                  {'  '}Body: {pushupDebug.bodyAlignment != null ? pushupDebug.bodyAlignment.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  HipDev: {pushupDebug.hipDev != null ? (pushupDebug.hipDev * 100).toFixed(1) + '%' : '–'}
                  {'  '}Head: {pushupDebug.headSpine != null ? pushupDebug.headSpine.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso Incl: {pushupDebug.torsoInclination != null ? pushupDebug.torsoInclination.toFixed(1) + '°' : '–'}
                  {' (65–115° = plank)'}
                </Text>
                {(pushupDebug.elbowMin != null || pushupDebug.bodyAngleMin != null) && (
                  <>
                    <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                      Rep Elbow: {pushupDebug.elbowMin != null ? pushupDebug.elbowMin.toFixed(1) : '–'}°–
                      {pushupDebug.elbowMax != null ? pushupDebug.elbowMax.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Rep Body: {pushupDebug.bodyAngleMin != null ? pushupDebug.bodyAngleMin.toFixed(1) : '–'}°–
                      {pushupDebug.bodyAngleMax != null ? pushupDebug.bodyAngleMax.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Rep HipDev: {pushupDebug.hipDevMin != null ? (pushupDebug.hipDevMin * 100).toFixed(1) : '–'}%–
                      {pushupDebug.hipDevMax != null ? (pushupDebug.hipDevMax * 100).toFixed(1) : '–'}%
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Rep Head: {pushupDebug.headSpineMin != null ? pushupDebug.headSpineMin.toFixed(1) : '–'}°–
                      {pushupDebug.headSpineMax != null ? pushupDebug.headSpineMax.toFixed(1) : '–'}°
                    </Text>
                  </>
                )}
                <Text style={styles.torsoDebugHint}>
                  Depth &lt;105° | Lock &gt;155° | Body 155–195° | Head ±25°
                </Text>
              </View>
            </View>
          )}

          </View>

          {/* Control strip — overlays bottom of 9:16 camera (same container, no gap) */}
          <View style={[styles.controlStrip, { paddingBottom: insets.bottom + SPACING.sm }]}>
            <View style={styles.controlStripMetrics}>
            <View style={styles.metricsCombined}>
              <View style={styles.metricBlock}>
                <Text style={styles.metricLabel}>REPS</Text>
                <MonoText style={styles.metricValue}>{displayValues.reps}</MonoText>
              </View>
              <View style={styles.metricBlock}>
                <Text style={styles.metricLabel}>FORM</Text>
                <MonoText style={styles.metricValue}>{displayValues.form}</MonoText>
              </View>
              <View style={styles.metricBlock}>
                <Text style={styles.metricLabel}>TIME</Text>
                <MonoText style={styles.metricValue}>{displayValues.timer}</MonoText>
              </View>
            </View>
          </View>
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
                  <View style={[styles.playIconTriangle, { borderLeftColor: isRecording ? COLORS.text : COLORS.textSecondary }]} />
                ) : (
                  <View style={styles.pauseIconBars}>
                    <View style={[styles.pauseIconBar, { backgroundColor: isRecording ? COLORS.text : COLORS.textSecondary }]} />
                    <View style={[styles.pauseIconBar, { backgroundColor: isRecording ? COLORS.text : COLORS.textSecondary }]} />
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.recordButton}
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
                <CameraSwitchIcon width={20} height={20} color={COLORS.text} />
              </TouchableOpacity>
            </View>
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
    flexDirection: 'column',
    backgroundColor: COLORS.background,
  },
  topBarSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: 4,
    backgroundColor: COLORS.background,
  },
  cameraArea: {
    flex: 1,
    flexDirection: 'column',
  },
  cameraSection: {
    width: '100%',
    position: 'relative',
  },
  cameraFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraContainer: {
    overflow: 'hidden',
  },
  controlStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingTop: SPACING.md,
  },
  controlStripMetrics: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
    zIndex: 5,
  },
  discardButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseTopCardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseTopCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonContainer: {
    alignItems: 'center',
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },
  /* Reference style: outer thin white ring, inner white circle with thin black border */
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  recordButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#FFFFFF',
  },
  pauseButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseIconBars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pauseIconBar: {
    width: 4,
    height: 18,
    borderRadius: 2,
  },
  playIconTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 3,
  },
  pauseButtonDisabled: {
    opacity: 0.5,
  },
  flipCameraButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 0,
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
  metricsOverlay: {
    position: 'absolute',
    bottom: SPACING.lg,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricsCombined: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: SPACING.sm,
  },
  metricBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 50,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    textAlign: 'center',
  },
  metricValue: {
    fontSize: 14,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
    minWidth: 30,
    textAlign: 'center',
  },
  recordButtonInnerActive: {
    backgroundColor: '#FF3B30',
    borderWidth: 0,
  },
  feedbackFeedContainer: {
    position: 'absolute',
    left: SPACING.screenHorizontal,
    bottom: SPACING.lg + 36 + SPACING.xl,
    right: undefined,
    maxWidth: '72%',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    gap: 6,
    zIndex: 10,
  },
  feedbackFeedItem: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  feedbackFeedText: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: '#FFFFFF',
  },
  torsoDebugContainer: {
    position: 'absolute',
    right: SPACING.screenHorizontal,
    bottom: SPACING.lg + 80,
    maxWidth: '85%',
    zIndex: 10,
  },
  torsoDebugCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 12,
    padding: SPACING.md,
  },
  torsoDebugTitle: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: 4,
  },
  torsoDebugText: {
    fontSize: 11,
    fontFamily: FONTS.mono.regular,
    color: COLORS.textSecondary,
  },
  torsoDebugHint: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: 4,
  },
});

