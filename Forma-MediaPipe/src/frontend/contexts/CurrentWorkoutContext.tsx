import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

export interface LoggedSet {
  exerciseName: string;
  reps: number;
  weight?: number;
  weightUnit?: 'kg' | 'lbs';
  formScore: number;
  /** Set duration in seconds (from camera timer). Shown in set notes. */
  durationSeconds?: number;
  /** Per-rep feedback shown during the set (e.g. "Great rep!", "Don't swing your back!") */
  repFeedback?: string[];
  /** Per-rep form scores (parallel to repFeedback, one per rep) */
  repFormScores?: number[];
  /** Manual sets track volume without camera analysis, form feedback, or recordings. */
  isManual?: boolean;
  /** Temp recording file URL — persisted to video library only at workout save time. */
  tempRecordingUrl?: string;
  /** Whether to save this set's recording to the video library (default true when recording exists). */
  saveRecordingToLibrary?: boolean;
  /** Whether to also save this set's recording to the device camera roll. */
  saveToCameraRoll?: boolean;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  category: string;
  sets: LoggedSet[];
}

export interface PendingRecording {
  tempUrl: string;
  exerciseName: string;
  formScore: number;
  reps: number;
  durationSeconds: number;
  sessionId: string;
}

type CurrentWorkoutContextValue = {
  exercises: WorkoutExercise[];
  sets: LoggedSet[]; // Derived from exercises for backward compatibility
  sessionId: string;
  workoutInProgress: boolean;
  workoutElapsedSeconds: number;
  workoutPaused: boolean;
  pendingRecording: PendingRecording | null;
  recordingFinalizationCount: number;
  addExercise: (exercise: { name: string; category: string }) => void;
  addSetToExercise: (exerciseId: string, set: LoggedSet) => void;
  addSet: (set: LoggedSet) => void; // Deprecated but kept for compatibility
  updateSetWeight: (exerciseId: string, setIndex: number, weight: number, unit: 'kg' | 'lbs') => void;
  updateManualSet: (exerciseId: string, setIndex: number, values: { reps: number; weight?: number; unit: 'kg' | 'lbs' }) => void;
  attachRecordingToSet: (exerciseId: string, setIndex: number, tempUrl: string) => void;
  updateSetRecordingFlags: (exerciseId: string, setIndex: number, flags: { saveToLibrary?: boolean; saveToCameraRoll?: boolean }) => void;
  removeExercise: (exerciseId: string) => void;
  removeSetFromExercise: (exerciseId: string, setIndex: number) => void;
  clearSets: () => void;
  setWorkoutInProgress: (value: boolean) => void;
  setWorkoutElapsedSeconds: (value: number | ((prev: number) => number)) => void;
  setWorkoutPaused: (value: boolean | ((prev: boolean) => boolean)) => void;
  setPendingRecording: (value: PendingRecording | null) => void;
  beginRecordingFinalization: () => void;
  endRecordingFinalization: () => void;
};

const defaultValue: CurrentWorkoutContextValue = {
  exercises: [],
  sets: [],
  sessionId: '',
  workoutInProgress: false,
  workoutElapsedSeconds: 0,
  workoutPaused: false,
  pendingRecording: null,
  recordingFinalizationCount: 0,
  addExercise: () => {},
  addSetToExercise: () => {},
  addSet: () => {},
  updateSetWeight: () => {},
  updateManualSet: () => {},
  attachRecordingToSet: () => {},
  updateSetRecordingFlags: () => {},
  removeExercise: () => {},
  removeSetFromExercise: () => {},
  clearSets: () => {},
  setWorkoutInProgress: () => {},
  setWorkoutElapsedSeconds: () => {},
  setWorkoutPaused: () => {},
  setPendingRecording: () => {},
  beginRecordingFinalization: () => {},
  endRecordingFinalization: () => {},
};

const CurrentWorkoutContext = createContext<CurrentWorkoutContextValue>(defaultValue);

export const CurrentWorkoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);
  const [workoutElapsedSeconds, setWorkoutElapsedSeconds] = useState(0);
  const [workoutPaused, setWorkoutPaused] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<PendingRecording | null>(null);
  const [recordingFinalizationCount, setRecordingFinalizationCount] = useState(0);
  const sessionIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const addExercise = useCallback((exercise: { name: string; category: string }) => {
    const newExercise: WorkoutExercise = {
      id: `${Date.now()}-${Math.random()}`,
      name: exercise.name,
      category: exercise.category,
      sets: [],
    };
    setExercises((prev) => [...prev, newExercise]);
  }, []);

  const addSetToExercise = useCallback((exerciseId: string, set: LoggedSet) => {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === exerciseId ? { ...ex, sets: [...ex.sets, set] } : ex
      )
    );
  }, []);

  // Deprecated: for backward compatibility
  const addSet = useCallback((set: LoggedSet) => {
    setExercises((prev) => {
      const existingExercise = prev.find((ex) => ex.name === set.exerciseName);
      if (existingExercise) {
        return prev.map((ex) =>
          ex.name === set.exerciseName ? { ...ex, sets: [...ex.sets, set] } : ex
        );
      }
      const newExercise: WorkoutExercise = {
        id: `${Date.now()}-${Math.random()}`,
        name: set.exerciseName,
        category: 'Weightlifting',
        sets: [set],
      };
      return [...prev, newExercise];
    });
  }, []);

  const updateSetWeight = useCallback((exerciseId: string, setIndex: number, weight: number, unit: 'kg' | 'lbs') => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id === exerciseId) {
          const updatedSets = [...ex.sets];
          if (updatedSets[setIndex]) {
            updatedSets[setIndex] = {
              ...updatedSets[setIndex],
              weight,
              weightUnit: unit,
            };
          }
          return { ...ex, sets: updatedSets };
        }
        return ex;
      })
    );
  }, []);

  const updateManualSet = useCallback((
    exerciseId: string,
    setIndex: number,
    values: { reps: number; weight?: number; unit: 'kg' | 'lbs' }
  ) => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id === exerciseId) {
          const updatedSets = [...ex.sets];
          if (updatedSets[setIndex]?.isManual) {
            updatedSets[setIndex] = {
              ...updatedSets[setIndex],
              reps: values.reps,
              weight: values.weight,
              weightUnit: values.unit,
            };
          }
          return { ...ex, sets: updatedSets };
        }
        return ex;
      })
    );
  }, []);

  const attachRecordingToSet = useCallback((exerciseId: string, setIndex: number, tempUrl: string) => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id === exerciseId) {
          const updatedSets = [...ex.sets];
          if (updatedSets[setIndex]) {
            const existingSet = updatedSets[setIndex];
            updatedSets[setIndex] = {
              ...existingSet,
              tempRecordingUrl: tempUrl,
              saveRecordingToLibrary: existingSet.saveRecordingToLibrary ?? true,
              saveToCameraRoll: existingSet.saveToCameraRoll ?? false,
            };
          }
          return { ...ex, sets: updatedSets };
        }
        return ex;
      })
    );
  }, []);

  const updateSetRecordingFlags = useCallback((exerciseId: string, setIndex: number, flags: { saveToLibrary?: boolean; saveToCameraRoll?: boolean }) => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id === exerciseId) {
          const updatedSets = [...ex.sets];
          if (updatedSets[setIndex]) {
            updatedSets[setIndex] = {
              ...updatedSets[setIndex],
              ...(flags.saveToLibrary !== undefined && { saveRecordingToLibrary: flags.saveToLibrary }),
              ...(flags.saveToCameraRoll !== undefined && { saveToCameraRoll: flags.saveToCameraRoll }),
            };
          }
          return { ...ex, sets: updatedSets };
        }
        return ex;
      })
    );
  }, []);

  useEffect(() => {
    if (!pendingRecording) return;

    setExercises((prev) => {
      const exercise = prev.find((ex) => ex.name === pendingRecording.exerciseName);
      if (!exercise) return prev;

      let targetIndex = -1;
      for (let i = exercise.sets.length - 1; i >= 0; i--) {
        if (!exercise.sets[i].tempRecordingUrl) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex < 0) return prev;

      return prev.map((ex) => {
        if (ex.id !== exercise.id) return ex;
        const updatedSets = [...ex.sets];
        const existingSet = updatedSets[targetIndex];
        updatedSets[targetIndex] = {
          ...existingSet,
          tempRecordingUrl: pendingRecording.tempUrl,
          durationSeconds: existingSet.durationSeconds ?? pendingRecording.durationSeconds,
          saveRecordingToLibrary: existingSet.saveRecordingToLibrary ?? true,
          saveToCameraRoll: existingSet.saveToCameraRoll ?? false,
        };
        return { ...ex, sets: updatedSets };
      });
    });

    setPendingRecording(null);
  }, [pendingRecording]);

  const beginRecordingFinalization = useCallback(() => {
    setRecordingFinalizationCount((count) => count + 1);
  }, []);

  const endRecordingFinalization = useCallback(() => {
    setRecordingFinalizationCount((count) => Math.max(0, count - 1));
  }, []);

  const removeExercise = useCallback((exerciseId: string) => {
    setExercises((prev) => prev.filter((ex) => ex.id !== exerciseId));
  }, []);

  const removeSetFromExercise = useCallback((exerciseId: string, setIndex: number) => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id === exerciseId && ex.sets.length > setIndex) {
          const newSets = ex.sets.filter((_, i) => i !== setIndex);
          return { ...ex, sets: newSets };
        }
        return ex;
      })
    );
  }, []);

  const clearSets = useCallback(() => {
    setExercises([]);
    setWorkoutInProgress(false);
    setWorkoutElapsedSeconds(0);
    setWorkoutPaused(false);
    setPendingRecording(null);
    setRecordingFinalizationCount(0);
    sessionIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, []);

  // Flatten exercises to sets for backward compatibility
  const sets = useMemo(() => {
    return exercises.flatMap((ex) => ex.sets);
  }, [exercises]);

  const contextValue = useMemo<CurrentWorkoutContextValue>(() => ({
    exercises,
    sets,
    sessionId: sessionIdRef.current,
    workoutInProgress,
    workoutElapsedSeconds,
    workoutPaused,
    pendingRecording,
    recordingFinalizationCount,
    addExercise,
    addSetToExercise,
    addSet,
    updateSetWeight,
    updateManualSet,
    attachRecordingToSet,
    updateSetRecordingFlags,
    removeExercise,
    removeSetFromExercise,
    clearSets,
    setWorkoutInProgress,
    setWorkoutElapsedSeconds,
    setWorkoutPaused,
    setPendingRecording,
    beginRecordingFinalization,
    endRecordingFinalization,
  }), [
    exercises, sets, workoutInProgress, workoutElapsedSeconds, workoutPaused, pendingRecording, recordingFinalizationCount,
    addExercise, addSetToExercise, addSet, updateSetWeight, updateManualSet, attachRecordingToSet,
    updateSetRecordingFlags, removeExercise, removeSetFromExercise, clearSets, beginRecordingFinalization, endRecordingFinalization,
  ]);

  return (
    <CurrentWorkoutContext.Provider value={contextValue}>
      {children}
    </CurrentWorkoutContext.Provider>
  );
};

export const useCurrentWorkout = (): CurrentWorkoutContextValue => {
  return useContext(CurrentWorkoutContext);
};
