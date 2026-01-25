import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { RNMediapipe, switchCamera } from '@thinksys/react-native-mediapipe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlipHorizontal, Pause, Play, Info, Dumbbell } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { RootStackParamList, RootTabParamList } from '../app/RootNavigator';
import { detectExercise, updateRepCount, Keypoint } from '../utils/poseAnalysis';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type CameraScreenRouteProp = RouteProp<RootTabParamList, 'Record'>;
type CameraScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Camera'>;

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
  const TAB_BAR_HEIGHT = 80;

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

  // Handle landmark data from MediaPipe
  const handleLandmark = useCallback((data: any) => {
    if (!isRecording || isPaused) return;

    // Throttle detection to prevent UI blocking (33ms = 30fps)
    const now = Date.now();
    if (now - lastDetectionTimeRef.current < 33) {
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
        
        // Update workout data
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

      // Navigate to SaveWorkout
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

  const handleCameraFlip = () => {
    switchCamera();
  };

  return (
    <View style={styles.container}>
      {/* MediaPipe Camera */}
      <View style={styles.cameraContainer}>
        <RNMediapipe
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT - insets.top - insets.bottom - TAB_BAR_HEIGHT}
          onLandmark={handleLandmark}
          face={true}
          leftArm={true}
          rightArm={true}
          torso={true}
          leftLeg={true}
          rightLeg={true}
          leftWrist={true}
          rightWrist={true}
          leftAnkle={true}
          rightAnkle={true}
        />
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
              { color: currentExercise ? COLORS.primary : COLORS.textSecondary }
            ]}>
              {currentExercise || 'No Exercise Detected'}
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
            paddingBottom: SPACING.lg,
            marginBottom: insets.bottom + TAB_BAR_HEIGHT,
          }
        ]}>
          {/* Metrics Row */}
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
                onPress={() => {
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
