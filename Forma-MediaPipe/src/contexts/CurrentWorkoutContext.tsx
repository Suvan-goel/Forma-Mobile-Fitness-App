import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export interface LoggedSet {
  exerciseName: string;
  reps: number;
  weight?: number;
  formScore: number;
  effortScore: number;
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
