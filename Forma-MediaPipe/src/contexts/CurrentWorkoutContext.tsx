import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export interface LoggedSet {
  exerciseName: string;
  reps: number;
  weight?: number;
  weightUnit?: 'kg' | 'lbs';
  formScore: number;
  /** Per-rep feedback shown during the set (e.g. "Great rep!", "Don't swing your back!") */
  repFeedback?: string[];
  /** Per-rep form scores (parallel to repFeedback, one per rep) */
  repFormScores?: number[];
}

export interface WorkoutExercise {
  id: string;
  name: string;
  category: string;
  sets: LoggedSet[];
}

type CurrentWorkoutContextValue = {
  exercises: WorkoutExercise[];
  sets: LoggedSet[]; // Derived from exercises for backward compatibility
  workoutInProgress: boolean;
  workoutElapsedSeconds: number;
  addExercise: (exercise: { name: string; category: string }) => void;
  addSetToExercise: (exerciseId: string, set: LoggedSet) => void;
  addSet: (set: LoggedSet) => void; // Deprecated but kept for compatibility
  updateSetWeight: (exerciseId: string, setIndex: number, weight: number, unit: 'kg' | 'lbs') => void;
  removeSetFromExercise: (exerciseId: string, setIndex: number) => void;
  clearSets: () => void;
  setWorkoutInProgress: (value: boolean) => void;
  setWorkoutElapsedSeconds: (value: number) => void;
};

const defaultValue: CurrentWorkoutContextValue = {
  exercises: [],
  sets: [],
  workoutInProgress: false,
  workoutElapsedSeconds: 0,
  addExercise: () => {},
  addSetToExercise: () => {},
  addSet: () => {},
  updateSetWeight: () => {},
  removeSetFromExercise: () => {},
  clearSets: () => {},
  setWorkoutInProgress: () => {},
  setWorkoutElapsedSeconds: () => {},
};

const CurrentWorkoutContext = createContext<CurrentWorkoutContextValue>(defaultValue);

export const CurrentWorkoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);
  const [workoutElapsedSeconds, setWorkoutElapsedSeconds] = useState(0);

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
  }, []);

  // Flatten exercises to sets for backward compatibility
  const sets = useMemo(() => {
    return exercises.flatMap((ex) => ex.sets);
  }, [exercises]);

  return (
    <CurrentWorkoutContext.Provider
      value={{
        exercises,
        sets,
        workoutInProgress,
        workoutElapsedSeconds,
        addExercise,
        addSetToExercise,
        addSet,
        updateSetWeight,
        removeSetFromExercise,
        clearSets,
        setWorkoutInProgress,
        setWorkoutElapsedSeconds,
      }}
    >
      {children}
    </CurrentWorkoutContext.Provider>
  );
};

export const useCurrentWorkout = (): CurrentWorkoutContextValue => {
  return useContext(CurrentWorkoutContext);
};
