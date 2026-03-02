import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Pressable, Dimensions, Platform, InteractionManager, Animated, ActivityIndicator } from 'react-native';
import { PoseDetectionView, switchCamera } from 'expo-pose-detection';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { X, Video, VideoOff } from 'lucide-react-native';
import CogIcon from '../components/icons/CogIcon';
import { COLORS, FONTS, SPACING, getScoreColor } from '../constants/theme';
import CameraSwitchIcon from '../components/icons/CameraSwitchIcon';
import PauseIcon from '../components/icons/PauseIcon';
import { MonoText } from '../components/typography/MonoText';
import { RootStackParamList, RecordStackParamList } from '../app/RootNavigator';
import { detectExercise, updateRepCount } from '../../utils/poseAnalysis';
import type { Keypoint } from '../../utils/poseAnalysis';
import '../../utils/exercises/definitions/register';
import { ExerciseRegistry } from '../../utils/exercises';
import type { ExerciseState } from '../../utils/exercises';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { useAlert } from '../contexts/AlertContext';
import { SetupGuideButton } from '../components/ui/SetupGuideButton';
import { onRepCompleted as ttsOnRepCompleted, onSetEnded as ttsOnSetEnded, onSetStarted as ttsOnSetStarted, resetCoachState as ttsResetCoach, stopCoach as ttsStopCoach } from '../../backend/services/ttsCoach';
import { setActiveVoiceId, setActiveVoiceSettings } from '../../backend/services/elevenlabsTTS';
import { TRAINERS, DEFAULT_TRAINER_ID } from '../constants/trainers';
import { EXERCISE_SETUP_DATA } from '../constants/exerciseGuideData';
import { useScreenRecording } from '../../backend/hooks/useScreenRecording';

/** Exercises with dedicated heuristics (FSM-based form analysis) */
const EXERCISES_WITH_HEURISTICS = new Set(['Barbell Curl', 'Push-Up']);

const MAX_FEED_ITEMS = 5;
type FeedbackFeedItem = { id: number; text: string };

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Use 'screen' height to include the Android navigation bar area (avoids black bar at bottom)
const { height: SCREEN_HEIGHT } = Dimensions.get('screen');

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
  const { showAlert } = useAlert();
  const { addSetToExercise, sessionId, setPendingRecording } = useCurrentWorkout();
  const { showFeedback, isTTSEnabled, showSkeletonOverlay, debugMode, selectedTrainerId, autoScreenRecording, setAutoScreenRecording, poseModel } = useCameraSettings();
  const { isRecordingScreen, isRecordingScreenRef, isAvailable: screenRecAvailable, startRecording: startScreenRec, stopRecording: stopScreenRec, cancelRecording: cancelScreenRec } = useScreenRecording();

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
  const [exerciseDebug, setExerciseDebug] = useState<Record<string, unknown> | null>(null);

  // Unified exercise state ref — populated via ExerciseRegistry on mount and recording start
  const exerciseStateRef = useRef<ExerciseState | null>(null);

  // Screen recording pulse animation + attempt tracking
  const screenRecPulseAnim = useRef(new Animated.Value(1)).current;
  const screenRecAttemptedRef = useRef(false);

  // Auto-recording toast
  const [autoRecToastText, setAutoRecToastText] = useState<string | null>(null);
  const autoRecToastAnim = useRef(new Animated.Value(0)).current;
  const autoRecToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // __DEV__-only: landmark recording refs (auto-record when set recording starts/stops)
  const isRecordingLandmarksRef = useRef(false);
  const landmarkBufferRef = useRef<Array<{ timestamp: number; keypoints: Keypoint[] }>>([]);
  const landmarkRecordingStartRef = useRef(0);

  const category = route.params?.category ?? 'Weightlifting';
  const exerciseNameFromRoute = route.params?.exerciseName;
  const exerciseId = route.params?.exerciseId;
  const returnToCurrentWorkout = route.params?.returnToCurrentWorkout ?? false;


  // Setup guide screen data
  const guideData = useMemo(() => {
    if (!exerciseNameFromRoute) return null;
    const def = ExerciseRegistry.has(exerciseNameFromRoute)
      ? ExerciseRegistry.get(exerciseNameFromRoute)
      : null;
    const viewMap = { front: 'FRONT', side: 'SIDE', any: 'ANY' } as const;
    const viewType = def ? viewMap[def.requiredView] : 'SIDE';
    const setup = EXERCISE_SETUP_DATA[exerciseNameFromRoute] ?? {
      keySetup: 'Position camera to capture full body',
      reasonText: 'Ensures all key joints are visible for tracking.',
      cameraTips: [
        'Place the phone far enough away to keep your whole body in frame.',
        'Set the camera roughly at hip to chest height depending on the lift.',
        'Avoid strong backlighting so your outline and joints are easy to detect.',
      ],
    };
    return { viewType, ...setup };
  }, [exerciseNameFromRoute]);

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

  // Keep ElevenLabs voice ID in sync with the selected trainer
  useEffect(() => {
    const trainer = TRAINERS.find((t) => t.id === selectedTrainerId) ?? TRAINERS.find((t) => t.id === DEFAULT_TRAINER_ID)!;
    setActiveVoiceId(trainer.voiceId);
    setActiveVoiceSettings(trainer.voiceSettings);
  }, [selectedTrainerId]);

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
    exerciseDebug?: Record<string, unknown> | null;
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

  // Clear debug info and initialize exercise state when route exercise changes
  useEffect(() => {
    setExerciseDebug(null);
    const def = exerciseNameFromRoute ? ExerciseRegistry.get(exerciseNameFromRoute) : undefined;
    if (def) {
      exerciseStateRef.current = def.createState();
    } else {
      exerciseStateRef.current = null;
    }
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
      if (pending.exerciseDebug !== undefined) setExerciseDebug(pending.exerciseDebug);
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

    // __DEV__-only: buffer keypoints for landmark recording
    if (__DEV__ && isRecordingLandmarksRef.current) {
      landmarkBufferRef.current.push({
        timestamp: Date.now() - landmarkRecordingStartRef.current,
        keypoints,
      });
    }

    // Registry-based exercise processing (handles all registered exercises uniformly)
    const exerciseDef = exerciseNameFromRoute ? ExerciseRegistry.get(exerciseNameFromRoute) : undefined;
    if (exerciseDef && exerciseStateRef.current) {
      const newState = exerciseDef.update(keypoints, exerciseStateRef.current);
      exerciseStateRef.current = newState;

      const repScore = newState.lastRepResult?.score ?? 0;

      // Accumulate UI updates — don't setState here (blocks main thread)
      const pending = pendingUIStateRef.current ?? {};
      pending.repCount = newState.repCount;
      if (repScore > 0) pending.formScore = repScore;
      pending.feedback = newState.feedback;
      pending.exerciseDebug = newState.debugInfo;

      if (newState.repCount > accumulatedFormScoresRef.current.length) {
        pending.workoutUpdate = {
          totalReps: newState.repCount,
          formScore: repScore,
          repFeedback: newState.feedback ?? 'Great rep!',
        };
        // Synchronous accumulation — immune to InteractionManager deferral race
        accumulatedFormScoresRef.current.push(repScore);
        accumulatedRepFeedbackRef.current.push(newState.feedback ?? 'Great rep!');

        // TTS coaching — fire-and-forget, does not block landmark processing
        if (isTTSEnabledRef.current) {
          const repMessages = newState.lastRepResult?.messages ?? [];
          ttsOnRepCompleted(repMessages, repScore).catch(() => {});
        }
      }
      pendingUIStateRef.current = pending;

      // Flush immediately when rep completes; otherwise throttle
      const repJustCompleted = newState.repCount > repCountRef.current;
      const throttleElapsed = now - lastUIUpdateTimeRef.current >= UI_UPDATE_INTERVAL_MS;
      if (repJustCompleted || throttleElapsed) {
        lastUIUpdateTimeRef.current = now;
        flushPendingUI();
      }
    } else if (!exerciseDef) {
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
          accumulatedFormScoresRef.current.push(formScore);
          accumulatedRepFeedbackRef.current.push(feedbackMsg);
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

  const handleRecordPress = useCallback(async () => {
    if (isRecording) {
      // Read per-rep data from synchronous refs (immune to InteractionManager deferral)
      pendingUIStateRef.current = null;
      const totalReps = accumulatedFormScoresRef.current.length;

      setIsRecording(false);
      setExerciseDebug(null);

      // __DEV__-only: dump landmark recording to Metro console
      if (__DEV__) {
        isRecordingLandmarksRef.current = false;
        if (landmarkBufferRef.current.length > 0) {
          const recording = {
            exerciseName: exerciseNameFromRoute || 'Unknown',
            metadata: {
              recordedAt: new Date().toISOString(),
              duration: (Date.now() - landmarkRecordingStartRef.current) / 1000,
              description: `${repCount} reps`,
              expectedReps: repCount,
              expectedScoreRange: [0, 100],
            },
            frames: landmarkBufferRef.current,
          };
          const json = JSON.stringify(recording);
          console.log('=== LANDMARK_RECORDING_START ===');
          const CHUNK = 4000;
          for (let i = 0; i < json.length; i += CHUNK) {
            console.log(json.slice(i, i + CHUNK));
          }
          console.log('=== LANDMARK_RECORDING_END ===');
          console.log(`[LandmarkRecording] ${landmarkBufferRef.current.length} frames, ${repCount} reps`);
        }
        landmarkBufferRef.current = [];
      }

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
        const wasRecording = screenRecAttemptedRef.current;
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

        // Stop screen recording if we attempted to start one.
        // Non-blocking: Samsung/Android MediaProjection can take 5-30s to finalize.
        // Navigate immediately; deliver the recording via context when ready.
        // Context setter survives CameraScreen unmount (provider is in RecordTabWithProvider).
        if (screenRecAttemptedRef.current) {
          screenRecAttemptedRef.current = false;
          const recMeta = {
            exerciseName: exerciseNameFromRoute,
            formScore: avgFormScore,
            reps: totalReps,
            durationSeconds: durationSeconds > 0 ? durationSeconds : 0,
            sessionId,
          };
          stopScreenRec().then((tempUrl) => {
            if (__DEV__) console.log('[CameraScreen] stopScreenRec resolved, tempUrl:', tempUrl);
            if (tempUrl) {
              setPendingRecording({ tempUrl, ...recMeta });
            }
          }).catch((err) => {
            if (__DEV__) console.warn('[CameraScreen] Screen recording stop failed:', err);
          });
        }

        // Unmount camera first so native layer releases it; prevents "Camera initialization failed" on next open
        setIsClosing(true);
        setCameraMounted(false);
        setTimeout(() => {
          (navigation as any).navigate('CurrentWorkout', {
            showWeightFor: { exerciseId, hasRecording: wasRecording },
          });
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
      setExerciseDebug(null);
      // Reset exercise state via registry
      const exerciseDef = exerciseNameFromRoute ? ExerciseRegistry.get(exerciseNameFromRoute) : undefined;
      if (exerciseDef) {
        exerciseStateRef.current = exerciseDef.createState();
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

      // __DEV__-only: start landmark recording
      if (__DEV__) {
        landmarkRecordingStartRef.current = Date.now();
        landmarkBufferRef.current = [];
        isRecordingLandmarksRef.current = true;
      }

      // Auto-start screen recording (if enabled in settings)
      if (screenRecAvailable && autoScreenRecording) {
        screenRecAttemptedRef.current = true;
        startScreenRec().catch(() => {
          if (__DEV__) console.warn('[CameraScreen] Auto screen recording start failed');
        });
      }
    }
  }, [isRecording, category, exerciseNameFromRoute, exerciseId, returnToCurrentWorkout, navigation, addSetToExercise, screenRecAvailable, startScreenRec, autoScreenRecording]);

  const handleAutoRecToggle = useCallback(() => {
    const next = !autoScreenRecording;
    setAutoScreenRecording(next);
    // Show toast
    if (autoRecToastTimer.current) clearTimeout(autoRecToastTimer.current);
    setAutoRecToastText(next ? 'Auto recording enabled' : 'Auto recording disabled');
    autoRecToastAnim.setValue(1);
    autoRecToastTimer.current = setTimeout(() => {
      Animated.timing(autoRecToastAnim, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => {
        setAutoRecToastText(null);
      });
    }, 1200);
  }, [autoScreenRecording, setAutoScreenRecording, autoRecToastAnim, autoRecToastTimer]);

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (autoRecToastTimer.current) clearTimeout(autoRecToastTimer.current);
    };
  }, []);

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

  // Screen recording: pulse animation
  useEffect(() => {
    if (isRecordingScreen) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(screenRecPulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(screenRecPulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      screenRecPulseAnim.setValue(1);
    }
  }, [isRecordingScreen, screenRecPulseAnim]);

  const handleDiscardSetPress = useCallback(() => {
    // Cancel any active screen recording on discard
    if (screenRecAttemptedRef.current || isRecordingScreenRef.current) {
      screenRecAttemptedRef.current = false;
      cancelScreenRec().catch(() => {});
    }
    showAlert(
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
  }, [navigation, isRecordingScreenRef, cancelScreenRec]);

  // Layout: camera fills entire screen; top bar and controls overlay on top.
  const topInset = insets.top + 6;
  const topBarHeight = topInset + 48;
  const cameraDisplayHeight = SCREEN_HEIGHT;
  const cameraDisplayWidth = SCREEN_WIDTH;
  const controlStripApproxHeight = 165 + insets.bottom;

  // Memoize pose detection props
  const effectiveShowSkeleton = debugMode || showSkeletonOverlay;
  const poseDetectionProps = useMemo(() => ({
    frameLimit: 30,
    showSkeleton: effectiveShowSkeleton,
    modelName: poseModel,
  }), [effectiveShowSkeleton, poseModel]);

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

  // Dynamic positioning for the setup guide ("?") button so it stays centered
  // between the discard "X" button and the exercise title text,
  // and the speaker icon centered between the title and the settings cog.
  const [headerMeasurements, setHeaderMeasurements] = useState<{
    leftRight: number | null;
    titleLeft: number | null;
    titleRight: number | null;
    questionWidth: number | null;
    settingsLeft: number | null;
    speakerWidth: number | null;
  }>({
    leftRight: null,
    titleLeft: null,
    titleRight: null,
    questionWidth: null,
    settingsLeft: null,
    speakerWidth: null,
  });

  const handleHeaderLeftLayout = useCallback((event: any) => {
    const { x, width } = event.nativeEvent.layout;
    setHeaderMeasurements(prev => ({
      ...prev,
      leftRight: x + width,
    }));
  }, []);

  const handleTitleLayout = useCallback((event: any) => {
    const { x, width } = event.nativeEvent.layout;
    setHeaderMeasurements(prev => ({
      ...prev,
      titleLeft: x,
      titleRight: x + width,
    }));
  }, []);

  const handleQuestionLayout = useCallback((event: any) => {
    const { width } = event.nativeEvent.layout;
    setHeaderMeasurements(prev => ({
      ...prev,
      questionWidth: width,
    }));
  }, []);

  const handleSettingsLayout = useCallback((event: any) => {
    const { x } = event.nativeEvent.layout;
    setHeaderMeasurements(prev => ({
      ...prev,
      settingsLeft: x,
    }));
  }, []);

  const handleSpeakerLayout = useCallback((event: any) => {
    const { width } = event.nativeEvent.layout;
    setHeaderMeasurements(prev => ({
      ...prev,
      speakerWidth: width,
    }));
  }, []);

  const questionLeft = useMemo(() => {
    const { leftRight, titleLeft, questionWidth } = headerMeasurements;
    if (leftRight == null || titleLeft == null || questionWidth == null) {
      return null;
    }
    const mid = (leftRight + titleLeft) / 2;
    return mid - questionWidth / 2;
  }, [headerMeasurements]);

  const speakerLeft = useMemo(() => {
    const { titleRight, settingsLeft, speakerWidth } = headerMeasurements;
    if (titleRight == null || settingsLeft == null || speakerWidth == null) {
      return null;
    }
    const mid = (titleRight + settingsLeft) / 2;
    return mid - speakerWidth / 2;
  }, [headerMeasurements]);

  const showCamera = cameraMounted && !isClosing;

  return (
    <View style={styles.container}>
      {/* Camera fills entire screen */}
      <View style={styles.cameraArea}>
        <View style={[styles.cameraSection, { height: cameraDisplayHeight }]}>
          <Pressable
            style={styles.cameraFill}
            onPress={handleCameraDoubleTap}
          >
            <View style={[styles.cameraContainer, { width: cameraDisplayWidth, height: cameraDisplayHeight }]}>
              {showCamera && (
                <PoseDetectionView
                  style={{ width: cameraDisplayWidth, height: cameraDisplayHeight }}
                  {...poseDetectionProps}
                  onLandmark={handleLandmark}
                />
              )}
            </View>
          </Pressable>

          {/* Overlay UI over camera (top bar, feedback, debug, controls) */}
          <View style={[styles.overlay, { height: cameraDisplayHeight }]}>
        {/* Top bar — overlays top of camera */}
        <View style={[styles.topBarSection, { paddingTop: topInset, height: topBarHeight }]}>
          <View style={styles.headerLeftGroup} onLayout={handleHeaderLeftLayout}>
            <TouchableOpacity
              style={styles.discardButton}
              onPress={handleDiscardSetPress}
              activeOpacity={0.8}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Discard set"
            >
              <X size={18} color={COLORS.text} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Setup guide button floated so '?' sits between X and exercise title */}
          <View
            onLayout={handleQuestionLayout}
            style={[
              styles.setupGuideButtonFloating,
              {
                left: questionLeft ?? SCREEN_WIDTH * 0.27 - 18,
                // Slightly below exact center so it visually matches text baseline
                top: topInset + 29 - 18, // 27 ≈ center (24) + 3px downward tweak
              },
            ]}
          >
            <SetupGuideButton
              onPress={() => {
                if (guideData) {
                  (navigation as any).navigate('ExerciseGuide', {
                    exerciseName: exerciseNameFromRoute ?? '',
                    category,
                    viewType: guideData.viewType,
                    keySetup: guideData.keySetup,
                    reasonText: guideData.reasonText,
                    cameraTips: guideData.cameraTips,
                  });
                }
              }}
            />
          </View>

          <View style={styles.exerciseTopCardWrap} onLayout={handleTitleLayout}>
            <Text style={styles.detectionExercise} numberOfLines={1}>
              {displayValues.exerciseDisplayName}
            </Text>
          </View>
          {/* Screen recording toggle floated so it sits centered between title and settings cog */}
          <View
            onLayout={handleSpeakerLayout}
            style={[
              styles.setupGuideButtonFloating,
              {
                left: speakerLeft ?? SCREEN_WIDTH * 0.73 - 10,
                top: topInset + 29 - 18,
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleAutoRecToggle}
              activeOpacity={0.8}
              style={styles.autoRecToggle}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={isRecordingScreen ? 'Screen recording active' : autoScreenRecording ? 'Disable auto screen recording' : 'Enable auto screen recording'}
            >
              {isRecordingScreen
                ? <Animated.View style={[styles.screenRecDot, { opacity: screenRecPulseAnim }]} />
                : autoScreenRecording
                  ? <Video size={20} color={COLORS.text} strokeWidth={2} />
                  : <VideoOff size={20} color="rgba(255,255,255,0.4)" strokeWidth={2} />}
            </TouchableOpacity>
          </View>
          <View style={styles.headerRightGroup} onLayout={handleSettingsLayout}>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => { ttsStopCoach(); (navigation as any).navigate('WorkoutSettings'); }}
              activeOpacity={0.8}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Camera settings"
            >
              <CogIcon size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Auto-recording toast */}
        {autoRecToastText && (
          <Animated.View style={[styles.autoRecToast, { opacity: autoRecToastAnim, top: topBarHeight + 8 }]} pointerEvents="none">
            <Text style={styles.autoRecToastText}>{autoRecToastText}</Text>
          </Animated.View>
        )}

        {/* Feedback Display - Speech bubble below exercise name. Debug: only last message. */}
        {(showFeedback || debugMode) && (() => {
          const filtered = feedbackFeed.filter(item => (item.text || '').trim() !== '');
          const items = debugMode ? filtered.slice(-1) : filtered.slice(-5);
          if (items.length === 0) return null;
          return (
            <View style={[styles.feedbackFeedContainer, { bottom: controlStripApproxHeight - 4 }]}>
              {items.map((item, index) => {
                // Opacity by position from newest: newest = 0.9, fading to 0.15 for oldest
                const positionFromNewest = items.length - 1 - index;
                const t = positionFromNewest >= 4 ? 0 : 1 - positionFromNewest / 4;
                const opacity = 0.15 + 0.75 * t;
                return (
                  <View
                    key={item.id}
                    style={[styles.feedbackFeedItem, { opacity }]}
                  >
                    <Text style={[styles.feedbackFeedText, (item.text === 'Great rep!' || item.text === 'Good rep.') && styles.feedbackFeedTextGood]} numberOfLines={2}>
                      {item.text}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* Barbell Curl Debug */}
        {exerciseNameFromRoute === 'Barbell Curl' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Barbell Curl</Text>
                <Text style={styles.torsoDebugText}>
                  L: {d.leftArmState ?? '–'} | R: {d.rightArmState ?? '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Elbow L: {d.current?.leftElbow != null ? d.current.leftElbow.toFixed(1) + '°' : '–'} | R: {d.current?.rightElbow != null ? d.current.rightElbow.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Shoulder L: {d.current?.leftShoulder != null ? d.current.leftShoulder.toFixed(1) + '°' : '–'} | R: {d.current?.rightShoulder != null ? d.current.rightShoulder.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso: {d.current?.torso != null ? d.current.torso.toFixed(1) + '°' : '–'}
                </Text>
                {d.repDelta && (
                  <>
                    <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>Δ rep:</Text>
                    <Text style={styles.torsoDebugText}>
                      Elbow L/R: {d.repDelta.leftElbow != null ? d.repDelta.leftElbow.toFixed(1) : '–'}° / {d.repDelta.rightElbow != null ? d.repDelta.rightElbow.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Shoulder L/R: {d.repDelta.leftShoulder != null ? d.repDelta.leftShoulder.toFixed(1) : '–'}° / {d.repDelta.rightShoulder != null ? d.repDelta.rightShoulder.toFixed(1) : '–'}°
                    </Text>
                    <Text style={styles.torsoDebugText}>
                      Torso Δ: {d.repDelta.torso != null ? d.repDelta.torso.toFixed(1) : '–'}°
                    </Text>
                  </>
                )}
                <Text style={styles.torsoDebugHint}>Torso warn &gt;12° fail &gt;22° | Shoulder fail &gt;65°</Text>
              </View>
            </View>
            );
          })()}

        {/* Push-Up Debug */}
        {exerciseNameFromRoute === 'Push-Up' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Push-Up</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | Side: {d.side}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Elbow: {d.elbow != null ? d.elbow.toFixed(1) + '°' : '–'}
                  {'  '}Body: {d.bodyAlignment != null ? d.bodyAlignment.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso Incl: {d.torsoInclination != null ? d.torsoInclination.toFixed(1) + '°' : '–'}
                  {'  '}HipDev: {d.hipDev != null ? (d.hipDev * 100).toFixed(1) + '%' : '–'}
                </Text>
                {d.elbowMin != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Elbow: {d.elbowMin.toFixed(1)}°–{d.elbowMax != null ? d.elbowMax.toFixed(1) : '–'}°
                    {'  '}HipDev: {d.hipDevMax != null ? (d.hipDevMax * 100).toFixed(1) : '–'}%
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Bottom &lt;105° | Lock &gt;155° | Body 155–195° | Incl 65–115°</Text>
              </View>
            </View>
            );
          })()}

        {/* Barbell Squat Debug */}
        {exerciseNameFromRoute === 'Barbell Squat' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Barbell Squat</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | Side: {d.side}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Knee: {d.knee != null ? d.knee.toFixed(1) + '°' : '–'}
                  {'  '}Torso: {d.torsoLean != null ? d.torsoLean.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Hip: {d.hipAngle != null ? d.hipAngle.toFixed(1) + '°' : '–'}
                </Text>
                {d.kneeMin != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Knee: {d.kneeMin.toFixed(1)}°–{d.kneeMax != null ? d.kneeMax.toFixed(1) : '–'}°
                    {'  '}Max Torso: {d.maxTorsoLean != null ? d.maxTorsoLean.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Bottom &lt;110° | Stand &gt;160° | Torso warn 50° fail 55°</Text>
              </View>
            </View>
            );
          })()}

        {/* Cable Pushdown Debug */}
        {exerciseNameFromRoute === 'Cable Pushdowns' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Cable Pushdown</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | Side: {d.side} | {d.warmedUp ? 'ready' : 'warming up'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Elbow: {d.elbow != null ? d.elbow.toFixed(1) + '°' : '–'}
                  {'  '}Shoulder: {d.shoulderAngle != null ? d.shoulderAngle.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso dev: {d.torsoDev != null ? d.torsoDev.toFixed(1) + '°' : '–'}
                </Text>
                {d.elbowMin != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Elbow: {d.elbowMin.toFixed(1)}°–{d.elbowMax != null ? d.elbowMax.toFixed(1) : '–'}°
                    {'  '}Shoulder Δ: {d.shoulderDelta != null ? d.shoulderDelta.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Push &gt;155° | Start &lt;100° | Drift warn 20° | Torso warn 12°</Text>
              </View>
            </View>
            );
          })()}

        {/* Cable Row Debug */}
        {exerciseNameFromRoute === 'Cable Row' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Cable Row</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | Side: {d.side} | {d.warmedUp ? 'ready' : 'warming up'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Elbow: {d.elbow != null ? d.elbow.toFixed(1) + '°' : '–'}
                  {'  '}Shoulder: {d.shoulderAngle != null ? d.shoulderAngle.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso dev: {d.torsoDev != null ? d.torsoDev.toFixed(1) + '°' : '–'}
                </Text>
                {d.elbowMin != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Elbow: {d.elbowMin.toFixed(1)}°–{d.elbowMax != null ? d.elbowMax.toFixed(1) : '–'}°
                    {'  '}Shoulder Δ: {d.shoulderDelta != null ? d.shoulderDelta.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Pull &lt;90° | Extend &gt;140° | Retract &gt;12° | Torso warn 15°</Text>
              </View>
            </View>
            );
          })()}

        {/* Lat Pulldown Debug */}
        {exerciseNameFromRoute === 'Cable Lat Pulldowns' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Lat Pulldown</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | {d.warmedUp ? 'ready' : 'warming up'} | {d.activeSide ?? '–'} arm
                </Text>
                <Text style={styles.torsoDebugText}>
                  Elbow: {d.elbow != null ? d.elbow.toFixed(1) + '°' : '–'}
                  {'  '}Torso: {d.torsoLean != null ? d.torsoLean.toFixed(1) + '°' : '–'}
                </Text>
                {d.minElbow != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep: {d.minElbow.toFixed(1)}°–{d.maxElbow != null ? d.maxElbow.toFixed(1) : '–'}°
                    {'  '}Max lean: {d.maxTorsoLean != null ? d.maxTorsoLean.toFixed(1) + '°' : '–'}
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Pull &lt;85° | Enter &lt;150° | Extend &gt;135° | Torso warn 20°</Text>
              </View>
            </View>
            );
          })()}

        {/* Lateral Raise Debug */}
        {exerciseNameFromRoute === 'Standing Dumbbell Lateral Raises' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Lateral Raise</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | {d.warmedUp ? 'ready' : 'warming up'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Abd L: {d.leftAbduction != null ? d.leftAbduction.toFixed(1) + '°' : '–'} | R: {d.rightAbduction != null ? d.rightAbduction.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Avg: {d.avgAbduction != null ? d.avgAbduction.toFixed(1) + '°' : '–'}
                  {'  '}Torso: {d.torsoLean != null ? d.torsoLean.toFixed(1) + '°' : '–'}
                  {'  '}Shrug: {d.shrugPct != null ? (d.shrugPct * 100).toFixed(1) + '%' : '–'}
                </Text>
                {d.maxAbduction != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Max Abd: {d.maxAbduction.toFixed(1)}°
                    {'  '}Asym: {d.maxAbductionDiff != null ? d.maxAbductionDiff.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Top &gt;70° | Full ROM &gt;80° | Lean warn 8° | Shrug warn 6%</Text>
              </View>
            </View>
            );
          })()}

        {/* Leg Extension Debug */}
        {exerciseNameFromRoute === 'Leg Extensions' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Leg Extension</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | Side: {d.side} | {d.warmedUp ? 'ready' : 'warming up'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Knee: {d.knee != null ? d.knee.toFixed(1) + '°' : '–'}
                  {'  '}Hip: {d.hipAngle != null ? d.hipAngle.toFixed(1) + '°' : '–'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Torso dev: {d.torsoDev != null ? d.torsoDev.toFixed(1) + '°' : '–'}
                </Text>
                {d.kneeMin != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Knee: {d.kneeMin.toFixed(1)}°–{d.kneeMax != null ? d.kneeMax.toFixed(1) : '–'}°
                    {'  '}Hip Δ: {d.hipDelta != null ? d.hipDelta.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Extend &gt;155° | Start &lt;105° | Hip lift warn 18°</Text>
              </View>
            </View>
            );
          })()}

        {/* Lying Leg Curl Debug */}
        {exerciseNameFromRoute === 'Lying Leg Curl' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Lying Leg Curl</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | Side: {d.side} | {d.warmedUp ? 'ready' : 'warming up'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Knee: {d.knee != null ? d.knee.toFixed(1) + '°' : '–'}
                  {'  '}Hip: {d.hipAngle != null ? d.hipAngle.toFixed(1) + '°' : '–'}
                </Text>
                {d.kneeMin != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Knee: {d.kneeMin.toFixed(1)}°–{d.kneeMax != null ? d.kneeMax.toFixed(1) : '–'}°
                    {'  '}Hip Δ: {d.hipDelta != null ? d.hipDelta.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Curl &lt;80° | Extend &gt;140° | Hip lift warn 12°</Text>
              </View>
            </View>
            );
          })()}

        {/* Machine Ab Crunch Debug */}
        {exerciseNameFromRoute === 'Machine Ab Crunches' &&
          debugMode &&
          exerciseDebug && (() => {
            const d = exerciseDebug as any;
            return (
            <View style={[styles.torsoDebugContainer, { bottom: controlStripApproxHeight + SPACING.lg }]}>
              <View style={styles.torsoDebugCard}>
                <Text style={styles.torsoDebugTitle}>Machine Ab Crunch</Text>
                <Text style={styles.torsoDebugText}>
                  {d.phase} | {d.warmedUp ? 'ready' : 'warming up'}
                </Text>
                <Text style={styles.torsoDebugText}>
                  Hip: {d.hipAngle != null ? d.hipAngle.toFixed(1) + '°' : '–'}
                  {'  '}Neck: {d.neckAngle != null ? d.neckAngle.toFixed(1) + '°' : '–'}
                </Text>
                {d.minHipAngle != null && (
                  <Text style={[styles.torsoDebugText, { marginTop: 4 }]}>
                    Rep Hip: {d.minHipAngle.toFixed(1)}°–{d.maxHipAngle != null ? d.maxHipAngle.toFixed(1) : '–'}°
                    {'  '}Max Neck: {d.maxNeckForward != null ? d.maxNeckForward.toFixed(1) : '–'}°
                  </Text>
                )}
                <Text style={styles.torsoDebugHint}>Crunch &lt;115° | Extend &gt;145° | Neck warn 30°</Text>
              </View>
            </View>
            );
          })()}

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
                <MonoText style={[styles.metricValue, currentFormScore != null && repCount > 0 && { color: getScoreColor(currentFormScore) }]}>{displayValues.form}</MonoText>
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
                  <PauseIcon size={20} color={isRecording ? COLORS.text : COLORS.textSecondary} />
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
                <CameraSwitchIcon width={24} height={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
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
    flexDirection: 'column',
    backgroundColor: COLORS.background,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBarSection: {
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  setupGuideButtonFloating: {
    position: 'absolute',
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
    padding: 0,
  },
  exerciseTopCardWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  exerciseTopCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsButton: {
    padding: 0,
  },
  autoRecToggle: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenRecDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#EF4444',
  },
  autoRecToast: {
    position: 'absolute',
    alignSelf: 'center',
    top: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 10,
  },
  autoRecToastText: {
    color: COLORS.text,
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
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
    fontSize: 13,
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
    width: 61,
    height: 61,
    borderRadius: 30.5,
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
  feedbackFeedTextGood: {
    color: '#34D399',
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

