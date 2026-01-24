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

// MediaPipe Pose Full model - 256×256 input, 33 landmarks output
const MEDIAPIPE_INPUT_SIZE = 256;

// MediaPipe Pose outputs 33 landmarks (vs MoveNet's 17)
// Format follows BlazePose topology
const KEYPOINT_NAMES = [
  'nose',              // 0
  'left_eye_inner',    // 1
  'left_eye',          // 2
  'left_eye_outer',    // 3
  'right_eye_inner',   // 4
  'right_eye',         // 5
  'right_eye_outer',   // 6
  'left_ear',          // 7
  'right_ear',         // 8
  'mouth_left',        // 9
  'mouth_right',       // 10
  'left_shoulder',     // 11
  'right_shoulder',    // 12
  'left_elbow',        // 13
  'right_elbow',       // 14
  'left_wrist',        // 15
  'right_wrist',       // 16
  'left_pinky',        // 17
  'right_pinky',       // 18
  'left_index',        // 19
  'right_index',       // 20
  'left_thumb',        // 21
  'right_thumb',       // 22
  'left_hip',          // 23
  'right_hip',         // 24
  'left_knee',         // 25
  'right_knee',        // 26
  'left_ankle',        // 27
  'right_ankle',       // 28
  'left_heel',         // 29
  'right_heel',        // 30
  'left_foot_index',   // 31
  'right_foot_index',  // 32
];

// Mapping from MediaPipe indices to common exercise keypoint names
// This enables compatibility with poseAnalysis.ts which uses name-based lookup
const MEDIAPIPE_LANDMARK_COUNT = 33;

// Available models
const MODELS = {
  // MediaPipe Pose Full - 33 landmarks, 256×256, high accuracy
  MEDIAPIPE_POSE_FULL: require('../../assets/models/pose_landmark_full.tflite'),
  // Legacy MoveNet models (kept for reference)
  MOVENET_LIGHTNING_QUANTIZED: require('../../assets/models/movenet_lightning_quantized.tflite'),
  MOVENET_THUNDER_QUANTIZED: require('../../assets/models/movenet_thunder_quantized.tflite'),
};

// MediaPipe Pose Full: 256×256 float32 model (33 landmarks, high accuracy)
const POSE_MODEL = MODELS.MEDIAPIPE_POSE_FULL;

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
  const [lastAngle, setLastAngle] = useState<number | null>(null);
  const [workoutStartTime, setWorkoutStartTime] = useState<Date | null>(null);
  const [workoutData, setWorkoutData] = useState({
    totalReps: 0,
    formScores: [] as number[],
    effortScores: [] as number[],
    duration: 0,
  });
  const [poseKeypoints, setPoseKeypoints] = useState<Keypoint[] | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const prevKeypointsRef = useRef<Keypoint[] | null>(null);

  const isFocused = useIsFocused();
  const isMountedRef = useRef(true);
  const TAB_BAR_HEIGHT = 80;
  const lastInferenceTime = useSharedValue(0);
  const isCameraActiveSV = useSharedValue(false);
  const isFrontCameraSV = useSharedValue(facing === 'front');
  const modelInputTypeSV = useSharedValue(0); // 0 unknown, 1 uint8, 2 int32, 3 float32

  const category = route.params?.category ?? 'Weightlifting';
  const modelState = useTensorflowModel(POSE_MODEL);
  const model = modelState.state === 'loaded' ? modelState.model : undefined;
  const { resize } = useResizePlugin();

  // MediaPipe Pose Full uses float32 input normalized to [0, 1]
  // We default to float32 if type detection fails
  useEffect(() => {
    if (!model) return;
    
    const input = model.inputs?.[0] as any;
    const dtypeRaw = input?.dataType ?? input?.dtype ?? input?.type ?? 'unknown';
    const dtype = typeof dtypeRaw === 'string' ? dtypeRaw : String(dtypeRaw);

    // MediaPipe Pose Full expects float32 input
    const dtypeLower = dtype.toLowerCase();
    if (dtypeLower.includes('float')) {
      modelInputTypeSV.value = 3; // float32
    } else if (dtypeLower.includes('uint8')) {
      modelInputTypeSV.value = 1; // uint8
    } else {
      // Default to float32 for MediaPipe
      modelInputTypeSV.value = 3;
    }
  }, [model, modelInputTypeSV]);

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

    // MediaPipe Pose Full outputs 33 landmarks
    // Output format depends on model variant:
    // - Some output [x, y, z, visibility] × 33 = 132 values
    // - Some output [x, y, z] × 33 = 99 values  
    // - Some output [x, y, z, visibility, presence] × 33 = 165 values
    // We handle multiple formats for compatibility
    
    const outputLen = flatOutput.length;
    let stride = 4; // Default: [x, y, z, visibility]
    
    // Determine stride based on output length
    if (outputLen === 99) {
      stride = 3; // [x, y, z] format
    } else if (outputLen === 132) {
      stride = 4; // [x, y, z, visibility] format
    } else if (outputLen === 165) {
      stride = 5; // [x, y, z, visibility, presence] format
    } else if (outputLen === 195) {
      stride = 5; // Extra fields, use first 5 per landmark
    } else if (outputLen === 198) {
      stride = 6; // Even more fields
    } else {
      // Try to infer stride
      stride = Math.floor(outputLen / MEDIAPIPE_LANDMARK_COUNT);
    }

    // Extract keypoints with coordinate mapping and strict validation
    const keypoints: Keypoint[] = new Array(MEDIAPIPE_LANDMARK_COUNT);
    
    for (let i = 0; i < MEDIAPIPE_LANDMARK_COUNT; i++) {
      const baseIdx = i * stride;
      
      // MediaPipe Pose outputs coordinates in PIXEL SPACE (0-256) relative to input image
      const modelX = flatOutput[baseIdx] / MEDIAPIPE_INPUT_SIZE;       // Convert 0-256 → 0-1
      const modelY = flatOutput[baseIdx + 1] / MEDIAPIPE_INPUT_SIZE;   // Convert 0-256 → 0-1
      // Z coordinate (depth) available at baseIdx + 2
      
      // Fast validation: coordinates must be within valid range
      // Use wider margins for better performance (less false rejections)
      const isValidX = modelX > 0.02 && modelX < 0.98;
      const isValidY = modelY > 0.02 && modelY < 0.98;
      const confidence = (isValidX && isValidY) ? 1.0 : 0.0;
      
      // Handle front camera mirroring
      const finalX = isFrontCamera ? (1 - modelX) : modelX;
      
      // Clamp coordinates to screen bounds for safety
      const clampedX = Math.max(0, Math.min(width, finalX * width));
      const clampedY = Math.max(0, Math.min(height, modelY * height));
      
      keypoints[i] = {
        name: KEYPOINT_NAMES[i],
        x: clampedX,
        y: clampedY,
        score: confidence,
      };
    }

    // FAST PERSON DETECTION: Minimal checks for performance
    // Core keypoints that MUST be present for a valid human detection
    const nose = keypoints[0];
    const leftShoulder = keypoints[11];
    const rightShoulder = keypoints[12];
    const leftHip = keypoints[23];
    const rightHip = keypoints[24];
    
    // 1. All core keypoints must be valid (most important check)
    if (nose.score < 1.0 || leftShoulder.score < 1.0 || rightShoulder.score < 1.0 || 
        leftHip.score < 1.0 || rightHip.score < 1.0) {
      setPoseKeypoints(null);
      prevKeypointsRef.current = null;
      return;
    }
    
    // 2. Quick anatomical check: shoulders must be above hips (fast Y comparison)
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    if (avgShoulderY >= avgHipY) {
      setPoseKeypoints(null);
      prevKeypointsRef.current = null;
      return;
    }
    
    // 3. Nose above shoulders (fast Y comparison)
    if (nose.y >= avgShoulderY) {
      setPoseKeypoints(null);
      prevKeypointsRef.current = null;
      return;
    }
    
    // Skip remaining expensive ratio checks for performance
    // The 3 checks above are sufficient to filter false positives

    // OPTIMIZED SMOOTHING - Reduced for better responsiveness
    const DEADZONE = 3;        // Smaller deadzone for faster response
    const SMOOTHING = 0.15;    // Less smoothing (85% current, 15% previous) for lower latency
    
    const prev = prevKeypointsRef.current;
    
    if (prev && prev.length === keypoints.length) {
      for (let i = 0; i < keypoints.length; i++) {
        const dx = keypoints[i].x - prev[i].x;
        const dy = keypoints[i].y - prev[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < DEADZONE) {
          // Below deadzone - keep previous position (eliminates jitter)
          keypoints[i].x = prev[i].x;
          keypoints[i].y = prev[i].y;
        } else if (dist > 100) {
          // Very large jump (>100px) - likely tracking error, use moderate smoothing
          keypoints[i].x = prev[i].x * 0.4 + keypoints[i].x * 0.6;
          keypoints[i].y = prev[i].y * 0.4 + keypoints[i].y * 0.6;
        } else {
          // Normal movement - apply light smoothing for responsiveness
          keypoints[i].x = prev[i].x * SMOOTHING + keypoints[i].x * (1 - SMOOTHING);
          keypoints[i].y = prev[i].y * SMOOTHING + keypoints[i].y * (1 - SMOOTHING);
        }
        
        // Light score smoothing
        keypoints[i].score = prev[i].score * 0.2 + keypoints[i].score * 0.8;
      }
    }

    prevKeypointsRef.current = keypoints;
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
      if (timestampMs - lastInferenceTime.value < 67) return; // ~15 FPS - Further reduced for better performance
      lastInferenceTime.value = timestampMs;

      if (model == null) {
        return;
      }

      const inputType = modelInputTypeSV.value;
      const isFrontCamera = isFrontCameraSV.value;

      // Front cameras need different rotation than back cameras
      // Back camera: 90deg (landscape left)
      // Front camera: 270deg (landscape right, because front camera is mirrored)
      const rotation = isFrontCamera ? '270deg' : '90deg';

      // MediaPipe Pose Full expects 256×256 float32 RGB input normalized to [0,1]
      // Use resize plugin to convert YUV→RGB, resize, AND rotate in one optimized step
      
      let inputTensor: Uint8Array | Float32Array;
      
      try {
        if (inputType === 1) {
          // Quantized model expects uint8 RGB
          inputTensor = resize(frame, {
            scale: {
              width: MEDIAPIPE_INPUT_SIZE,
              height: MEDIAPIPE_INPUT_SIZE,
            },
            pixelFormat: 'rgb',
            dataType: 'uint8',
            rotation: rotation,
          });
        } else {
          // MediaPipe float model expects float32 RGB normalized to [0,1]
          // Default to float32 if inputType is unknown (0) or explicitly float32 (3)
          inputTensor = resize(frame, {
            scale: {
              width: MEDIAPIPE_INPUT_SIZE,
              height: MEDIAPIPE_INPUT_SIZE,
            },
            pixelFormat: 'rgb',
            dataType: 'float32',
            rotation: rotation,
          });
        }
      } catch (e) {
        return;
      }

      let rawOut: any;
      try {
        rawOut = model.runSync([inputTensor])[0];
      } catch (e) {
        return;
      }
      
      let outputArray: number[] | Float32Array;
      // MediaPipe models can output in different formats:
      // 1. Float32Array: Already flat typed array
      // 2. Regular array: [x1, y1, z1, vis1, ...]
      // 3. Nested array: [[x1, y1, z1, vis1], [x2, y2, z2, vis2], ...]
      
      // Handle typed arrays (Float32Array, Uint8Array, etc.)
      const flat: number[] = [];
      
      if (rawOut instanceof Float32Array || rawOut instanceof Uint8Array || rawOut instanceof Int8Array) {
        // Typed array - directly convert to regular array
        for (let i = 0; i < rawOut.length; i++) {
          flat.push(rawOut[i]);
        }
      } else {
        // Regular array or nested structure - flatten recursively
        const flatten = (arr: any) => {
          if (Array.isArray(arr)) {
            for (const item of arr) {
              flatten(item);
            }
          } else if (typeof arr === 'number') {
            flat.push(arr);
          }
        };
        flatten(rawOut);
      }
      
      const outLen = flat.length;
      
      // MediaPipe outputs vary: 99 (x,y,z), 132 (x,y,z,vis), 165 (x,y,z,vis,pres), 195 (extra fields)
      const minExpectedLen = MEDIAPIPE_LANDMARK_COUNT * 3; // 99
      const maxExpectedLen = MEDIAPIPE_LANDMARK_COUNT * 6; // 198 (allow extra fields)
      
      if (outLen < minExpectedLen || outLen > maxExpectedLen) {
        return;
      }
      
      outputArray = new Float32Array(flat);

      // Extract flat output array and send to JS
      const finalFlat: number[] = [];
      for (let i = 0; i < outLen; i += 1) {
        finalFlat.push(outputArray[i]);
      }

      sendPoseOutputToJS(finalFlat, isFrontCameraSV.value, frame.width, frame.height);
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

  // Fast exercise detection - runs at most every 80ms for responsive tracking
  useEffect(() => {
    if (!isRecording || isPaused || !poseKeypoints || poseKeypoints.length === 0) {
      return;
    }

    // Throttle detection to prevent UI blocking (increased from 150ms to 80ms for responsiveness)
    const now = Date.now();
    if (now - lastDetectionTimeRef.current < 80) {
      return; // Skip this frame
    }
    lastDetectionTimeRef.current = now;

    // Run detection
    const detection = detectExercise(poseKeypoints);
    
    if (detection.exercise && detection.angle !== null) {
      const exerciseName = detection.exercise;
      
      // Update exercise name if changed (batch with phase reset)
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

      // Rep completed - batch all updates into single setWorkoutData call
      if (repUpdate.repCount > repCountRef.current) {
        const formScore = repUpdate.formScore;
        const effortScore = Math.min(95, 75 + Math.floor(detection.confidence * 20));
        
        setRepCount(repUpdate.repCount);
        setCurrentFormScore(formScore);
        setCurrentEffortScore(effortScore);
        
        // Single batched update for workout data
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
            frameProcessorFps={15}
            pixelFormat="yuv"
            photo={false}
            video={false}
            androidPreviewViewType="texture-view"
          />
        ) : null}
        <PoseOverlay
          keypoints={poseKeypoints}
          width={previewSize.width}
          height={previewSize.height}
          mirror={false}
          minScore={facing === 'front' ? 0.25 : 0.35}
        />
      </View>
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

