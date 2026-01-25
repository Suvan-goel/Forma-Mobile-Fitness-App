import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Linking, AppState } from 'react-native';
import { Camera, CameraPermissionStatus, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlipHorizontal, Pause, Play, Info, Dumbbell } from 'lucide-react-native';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { RootStackParamList, RootTabParamList } from '../app/RootNavigator';
import { PoseOverlay } from '../components/PoseOverlay';
import { detectExercise, updateRepCount } from '../utils/poseAnalysis';

type Keypoint = {
  name: string;
  x: number;
  y: number;
  score: number;
};

// Detect model size dynamically - will be set based on actual model
// Thunder uses 256x256, Lightning uses 192x192
let MOVENET_INPUT_SIZE = 256; // default for Thunder, will be overridden if different
const KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

// Available models - switch between them for testing
const MODELS = {
  LIGHTNING_QUANTIZED: require('../../assets/models/movenet_lightning_quantized.tflite'),
  LIGHTNING_FLOAT32: require('../../assets/models/movenet_lightning_float32.tflite'),
  THUNDER_QUANTIZED: require('../../assets/models/movenet_thunder_quantized.tflite'),
  THUNDER_FLOAT16: require('../../assets/models/movenet_thunder_float16.tflite'),
};

// MoveNet Thunder Float16: 256×256 FP16 model for highest accuracy
// Balanced performance (~20-30ms inference) with superior pose detection quality
// Ideal for fitness applications requiring precise form analysis
const MOVENET_MODEL = MODELS.THUNDER_QUANTIZED;
// Alternative models for different use cases:
// LIGHTNING_QUANTIZED: 192×192 uint8 (~10-15ms, lowest latency, good accuracy)
// LIGHTNING_FLOAT32: 192×192 float32 (~25-30ms, balanced)
// THUNDER_QUANTIZED: 256×256 uint8 (~15-20ms, high accuracy, fast)

type CameraScreenRouteProp = RouteProp<RootTabParamList, 'Record'>;
type CameraScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Camera'>;

export const CameraScreen: React.FC = () => {
  const navigation = useNavigation<CameraScreenNavigationProp>();
  const route = useRoute<CameraScreenRouteProp>();
  const insets = useSafeAreaInsets();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const device = useCameraDevice(facing);
  const [cameraPermission, setCameraPermission] = useState<CameraPermissionStatus>('not-determined');
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
  const [poseKeypoints, setPoseKeypoints] = useState<Keypoint[] | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  
  // Use refs to minimize re-renders and track frame timing
  const prevKeypointsRef = useRef<Keypoint[] | null>(null);

  const isFocused = useIsFocused();
  const isMountedRef = useRef(true);
  const TAB_BAR_HEIGHT = 80;
  const lastInferenceTime = useSharedValue(0);
  const isCameraActiveSV = useSharedValue(false);
  const isFrontCameraSV = useSharedValue(facing === 'front');
  const modelInputTypeSV = useSharedValue(0); // 0 unknown, 1 uint8, 2 int32, 3 float32

  const category = route.params?.category ?? 'Weightlifting';
  const modelState = useTensorflowModel(MOVENET_MODEL);
  const model = modelState.state === 'loaded' ? modelState.model : undefined;
  const { resize } = useResizePlugin();
  const outputQuantParamsSV = useSharedValue<{zeroPoint: number; scale: number} | null>(null);

  // Detect actual model contract and adapt
  useEffect(() => {
    if (!model) return;
    
    const input = model.inputs?.[0] as any;
    const shape = input?.shape ? JSON.stringify(input.shape) : 'unknown';
    const dtypeRaw = input?.dataType ?? input?.dtype ?? input?.type ?? 'unknown';
    const dtype = typeof dtypeRaw === 'string' ? dtypeRaw : String(dtypeRaw);

    // Extract model size from shape [1, H, W, 3]
    const shapeMatch = shape.match(/\[1,(\d+),(\d+),3\]/);
    if (shapeMatch) {
      const h = parseInt(shapeMatch[1], 10);
      const w = parseInt(shapeMatch[2], 10);
      if (h === w && (h === 192 || h === 256)) {
        MOVENET_INPUT_SIZE = h;
      }
    }

    // Detect dtype
    const dtypeLower = dtype.toLowerCase();
    
    if (dtypeLower.includes('uint8')) {
      modelInputTypeSV.value = 1; // uint8
      outputQuantParamsSV.value = null;
    } else if (dtypeLower.includes('float')) {
      modelInputTypeSV.value = 3; // float32
      outputQuantParamsSV.value = null;
    }
  }, [model, modelInputTypeSV, outputQuantParamsSV]);

  const syncCameraPermission = useCallback(async () => {
    const status = await Camera.getCameraPermissionStatus();
    if (!isMountedRef.current) return;

    if (status === 'not-determined') {
      const newStatus = await Camera.requestCameraPermission();
      if (!isMountedRef.current) return;
      setCameraPermission(newStatus);
      return;
    }

    setCameraPermission(status);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    syncCameraPermission();

    return () => {
      isMountedRef.current = false;
    };
  }, [syncCameraPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        syncCameraPermission(); // Re-check when returning to foreground.
      }
    });

    return () => {
      subscription.remove();
    };
  }, [syncCameraPermission]);

  useEffect(() => {
    if (isFocused) {
      syncCameraPermission();
    }
  }, [isFocused, syncCameraPermission]);

  const hasPermission = ['granted', 'authorized'].includes(
    cameraPermission as string
  );
  const shouldCameraBeActive = isFocused && hasPermission && !isPaused;

  useEffect(() => {
    isCameraActiveSV.value = shouldCameraBeActive;
  }, [shouldCameraBeActive, isCameraActiveSV]);

  useEffect(() => {
    isFrontCameraSV.value = facing === 'front';
  }, [facing, isFrontCameraSV]);

  const onPoseOutputFromWorklet = useCallback((flatOutput: number[], isFrontCamera: boolean, frameWidth: number, frameHeight: number) => {
    const width = previewSize.width;
    const height = previewSize.height;
    if (width === 0 || height === 0) return;

    // Calculate aspect ratio correction for coordinate mapping
    // After 90deg/270deg rotation, frame dimensions are swapped
    // Model processes square 192x192 input with aspect ratio maintained (letterboxed/pillarboxed)
    
    const rotatedWidth = frameHeight;
    const rotatedHeight = frameWidth;
    const frameAspectRatio = rotatedWidth / rotatedHeight;
    
    // Model input is square (1.0 aspect ratio)
    let contentScaleX = 1.0;
    let contentScaleY = 1.0;
    let contentOffsetX = 0.0;
    let contentOffsetY = 0.0;
    
    if (frameAspectRatio > 1.0) {
      contentScaleY = frameAspectRatio;
      contentOffsetY = (contentScaleY - 1.0) / 2.0;
    } else if (frameAspectRatio < 1.0) {
      contentScaleX = 1.0 / frameAspectRatio;
      contentOffsetX = (contentScaleX - 1.0) / 2.0;
    }

    // Extract and transform keypoints
    const keypoints: Keypoint[] = new Array(KEYPOINT_NAMES.length);
    let totalScore = 0;
    
    for (let i = 0; i < KEYPOINT_NAMES.length; i++) {
      const modelY = flatOutput[i * 3];
      const modelX = flatOutput[i * 3 + 1];
      const score = flatOutput[i * 3 + 2];
      totalScore += score;
      
      const correctedX = (modelX * contentScaleX) - contentOffsetX;
      const correctedY = (modelY * contentScaleY) - contentOffsetY;
      
      keypoints[i] = {
        name: KEYPOINT_NAMES[i],
        x: correctedX * width,
        y: correctedY * height,
        score,
      };
    }

    // Confidence threshold - preserve detection quality
    const confidenceThreshold = isFrontCamera ? 0.12 : 0.18;
    if (totalScore / KEYPOINT_NAMES.length < confidenceThreshold) {
      prevKeypointsRef.current = null;
      // LATENCY: Update state immediately (no delays)
      setPoseKeypoints(null);
      return;
    }

    // LATENCY: Minimal smoothing - only sub-pixel jitter to preserve correctness
    // No smoothing on real movement to avoid added latency
    const prev = prevKeypointsRef.current;
    if (prev && prev.length === keypoints.length) {
      const JITTER_THRESHOLD_SQ = 0.5; // 0.7px - only filter sensor noise
      for (let i = 0; i < keypoints.length; i++) {
        const current = keypoints[i];
        const previous = prev[i];
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const distSq = dx * dx + dy * dy;
        
        if (distSq < JITTER_THRESHOLD_SQ) {
          // Sub-pixel jitter only
          current.x = previous.x * 0.3 + current.x * 0.7;
          current.y = previous.y * 0.3 + current.y * 0.7;
        }
        // All other movement: no smoothing for instant response
      }
    }

    prevKeypointsRef.current = keypoints;
    
    // LATENCY: Update state IMMEDIATELY - no throttle, no rAF
    // Direct state update for fastest response
    setPoseKeypoints(keypoints);
  }, [previewSize.width, previewSize.height]);

  const sendPoseOutputToJS = useMemo(
    () => Worklets.createRunOnJS(onPoseOutputFromWorklet),
    [onPoseOutputFromWorklet]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (!isCameraActiveSV.value) return;

      const timestamp = frame.timestamp;
      const timestampMs =
        timestamp > 1e12 ? timestamp / 1e6 : timestamp > 1e9 ? timestamp / 1e3 : timestamp * 1000;
      // Thunder FP16: Target ~24 FPS inference (model ~20-30ms, leaves headroom)
      // Slightly lower rate than Lightning to prevent frame backup
      if (timestampMs - lastInferenceTime.value < 42) return; // ~24 FPS
      lastInferenceTime.value = timestampMs;

      if (model == null) return;

      // Use resize plugin to convert YUV to RGB, resize, AND rotate in one optimized step
      // This properly handles the YUV->RGB conversion that Android cameras require
      // AND rotates 90° CW for portrait mode (much faster than manual rotation)
      const inputType = modelInputTypeSV.value; // 1=uint8, 3=float32
      
      // Wait for model metadata to be detected before processing frames
      if (inputType === 0) return;
      
      let inputTensor: Uint8Array | Float32Array;
      
      // Front camera needs 270deg rotation (or -90deg), back camera needs 90deg
      // This ensures the model receives properly oriented frames for accurate detection
      const rotation = isFrontCameraSV.value ? '270deg' : '90deg';
      
      try {
        if (inputType === 1) {
          // Quantized model expects uint8 RGB
          inputTensor = resize(frame, {
            scale: {
              width: MOVENET_INPUT_SIZE,
              height: MOVENET_INPUT_SIZE,
            },
            pixelFormat: 'rgb',
            dataType: 'uint8',
            rotation, // Apply camera-specific rotation
          });
        } else {
          // Float model expects float32 RGB normalized to [0,1]
          inputTensor = resize(frame, {
            scale: {
              width: MOVENET_INPUT_SIZE,
              height: MOVENET_INPUT_SIZE,
            },
            pixelFormat: 'rgb',
            dataType: 'float32',
            rotation, // Apply camera-specific rotation
          });
        }
      } catch (e) {
        // Silently fail and skip this frame
        return;
      }

      // Run inference with typed array input
      let rawOut: any;
      try {
        rawOut = model.runSync([inputTensor])[0];
      } catch (e) {
        // Model inference failed - skip this frame
        console.warn('Model inference error:', e);
        return;
      }
      
      // Fast extraction - Lightning Quantized returns data directly
      const expectedOutLen = 51; // 17 keypoints * 3 values
      
      // Most common case: array with correct length
      if (rawOut && rawOut.length === expectedOutLen) {
        // Direct pass to JS - avoid intermediate array creation
        const flat: number[] = new Array(expectedOutLen);
        for (let i = 0; i < expectedOutLen; i++) {
          flat[i] = rawOut[i];
        }
        sendPoseOutputToJS(flat, isFrontCameraSV.value, frame.width, frame.height);
        return;
      }
      
      // Handle nested array (rare case)
      if (Array.isArray(rawOut)) {
        const flat: number[] = [];
        const flatten = (arr: any) => {
          for (let i = 0; i < arr.length; i++) {
            if (Array.isArray(arr[i])) flatten(arr[i]);
            else if (typeof arr[i] === 'number') flat.push(arr[i]);
          }
        };
        flatten(rawOut);
        if (flat.length === expectedOutLen) {
          sendPoseOutputToJS(flat, isFrontCameraSV.value, frame.width, frame.height);
        }
      }
    },
    [model, resize, sendPoseOutputToJS, isFrontCameraSV]
  );

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

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

  // Exercise detection - throttled to 100ms to not block skeleton rendering
  useEffect(() => {
    if (!isRecording || isPaused || !poseKeypoints || poseKeypoints.length === 0) {
      return;
    }

    // Throttle exercise detection to 10fps (100ms) - it doesn't need to be as fast as skeleton
    const now = Date.now();
    if (now - lastDetectionTimeRef.current < 100) {
      return;
    }
    lastDetectionTimeRef.current = now;

    // Run detection
    const detection = detectExercise(poseKeypoints);
    
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

      // Rep completed - batch all updates
      if (repUpdate.repCount > repCountRef.current) {
        const formScore = repUpdate.formScore;
        const effortScore = Math.min(95, 75 + Math.floor(detection.confidence * 20));
        
        setRepCount(repUpdate.repCount);
        setCurrentFormScore(formScore);
        setCurrentEffortScore(effortScore);
        
        setWorkoutData(prev => ({
          ...prev,
          totalReps: prev.totalReps + 1,
          formScores: [...prev.formScores, formScore],
          effortScores: [...prev.effortScores, effortScore],
        }));
      }
    } else if (currentExerciseRef.current !== null) {
      setCurrentExercise(null);
      setExercisePhase('idle');
    }
  }, [isRecording, isPaused, poseKeypoints]);

  const handleRecordPress = () => {
    if (isRecording) {
      // Stop recording and navigate to SaveWorkout
      setIsRecording(false);
      
      // Calculate workout data
      const avgFormScore = workoutData.formScores.length > 0
        ? Math.round(workoutData.formScores.reduce((a, b) => a + b, 0) / workoutData.formScores.length)
        : 0;
      const avgEffortScore = workoutData.effortScores.length > 0
        ? Math.round(workoutData.effortScores.reduce((a, b) => a + b, 0) / workoutData.effortScores.length)
        : 0;
      
      const minutes = Math.floor(workoutData.duration / 60);
      const seconds = workoutData.duration % 60;
      const durationString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      // Prepare workout data
      const workoutDataToSave = {
        category,
        duration: durationString,
        totalReps: workoutData.totalReps,
        avgFormScore,
        avgEffortScore,
      };

      // Navigate to SaveWorkout, replacing Camera in the stack
      setTimeout(() => {
        navigation.replace('SaveWorkout', {
          workoutData: workoutDataToSave,
        });
      }, 100);
    } else {
      // Start recording
      setIsRecording(true);
      setWorkoutStartTime(new Date());
      setCurrentExercise(null);
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
  };

  const handlePausePress = () => {
    setIsPaused(!isPaused);
  };


  if (cameraPermission === 'not-determined') {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            Camera permission is disabled. Enable it in Android system settings to record workouts.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={async () => {
              await Camera.requestCameraPermission();
              await syncCameraPermission();
            }}
          >
            <Text style={styles.permissionButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => Linking.openSettings()}
          >
            <Text style={styles.backButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show loading indicator while model is loading
  if (modelState.state === 'loading') {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Loading pose detection model...</Text>
      </View>
    );
  }

  // Show error if model failed to load
  if (modelState.state === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Model Loading Failed</Text>
          <Text style={styles.permissionText}>
            Failed to load pose detection model. Please restart the app.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={styles.cameraContainer}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setPreviewSize({ width, height });
        }}
      >
        {device ? (
          <Camera
            style={styles.camera}
            device={device}
            isActive={shouldCameraBeActive}
            frameProcessor={shouldCameraBeActive && model ? frameProcessor : undefined}
            // @ts-ignore - frameProcessorFps available at runtime
            frameProcessorFps={30}
            pixelFormat="yuv"
            photo={false}
            video={false}
            androidPreviewViewType="texture-view"
            // Lower resolution for faster processing
            // @ts-ignore
            videoStabilizationMode="off"
            // @ts-ignore - exposure optimization
            exposure={0}
          />
        ) : null}
        <PoseOverlay
          keypoints={poseKeypoints}
          width={previewSize.width}
          height={previewSize.height}
          mirror={facing === 'front'}
          minScore={facing === 'front' ? 0.12 : 0.18}
        />
      </View>
      <View style={styles.overlay} pointerEvents="box-none">
        {modelState.state !== 'loaded' && (
          <View style={[styles.modelStatus, { top: insets.top + SPACING.lg }]} pointerEvents="none">
            <Text style={styles.modelStatusText}>Pose model loading...</Text>
          </View>
        )}
        {/* Top Bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + SPACING.xs }]}>
          <View style={styles.weightsIconContainer}>
            <Dumbbell size={24} color={COLORS.text} />
          </View>
          <View style={styles.exerciseTopCard}>
            <Text style={styles.detectionLabel}>EXERCISE</Text>
            <Text style={[
              styles.detectionExercise,
              { color: currentExercise ? COLORS.primary : COLORS.textSecondary }
            ]}>
              {currentExercise || 'No Exercise Detected'}
            </Text>
          </View>
          <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
            <FlipHorizontal size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {!device && (
          <View style={styles.loadingContainer} pointerEvents="none">
            <Text style={styles.permissionText}>Loading camera...</Text>
          </View>
        )}

        {/* Bottom Controls */}
        <View style={[
          styles.bottomBar,
          {
            paddingBottom: SPACING.lg,
            marginBottom: insets.bottom + TAB_BAR_HEIGHT, // Keep controls above tab bar.
          }
        ]}>
          {/* Metrics Row - Reps, Form, Effort */}
          <View style={[styles.metricsContainer, { marginBottom: SPACING.lg }]}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Reps</Text>
              <MonoText style={styles.metricValue}>
                {repCount > 0 ? repCount : '-'}
              </MonoText>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Form</Text>
              <MonoText style={styles.metricValue}>
                {repCount > 0 && currentFormScore !== null ? currentFormScore : '-'}
              </MonoText>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Effort</Text>
              <MonoText style={styles.metricValue}>
                {repCount > 0 && currentEffortScore !== null ? currentEffortScore : '-'}
              </MonoText>
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
                onPress={() => {
                  // Navigate to WorkoutInfo
                  (navigation as any).push('WorkoutInfo');
                }}
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
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  poseDebug: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: SPACING.sm,
    borderRadius: 8,
  },
  poseDebugText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  modelStatus: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  modelStatusText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  instructionsContainer: {
    alignItems: 'center',
    gap: SPACING.xs,
  },
  instructionText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  pauseInstructionText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
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
    zIndex: 100,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  permissionTitle: {
    fontSize: 24,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  permissionButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 16,
    marginBottom: SPACING.md,
  },
  permissionButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.background,
  },
  backButton: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
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
    backgroundColor: '#FF3B30', // Red when recording
  },
});
