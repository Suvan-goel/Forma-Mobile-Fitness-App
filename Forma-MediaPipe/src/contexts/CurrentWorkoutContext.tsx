import React, { createContext, useContext, useState, useCallback } from 'react';

export interface LoggedSet {
  exerciseName: string;
  reps: number;
  weight?: number;
  formScore: number;
  effortScore: number;
}

type CurrentWorkoutContextValue = {
  sets: LoggedSet[];
  workoutInProgress: boolean;
  workoutElapsedSeconds: number;
  addSet: (set: LoggedSet) => void;
  clearSets: () => void;
  setWorkoutInProgress: (value: boolean) => void;
  setWorkoutElapsedSeconds: (value: number) => void;
};

const defaultValue: CurrentWorkoutContextValue = {
  sets: [],
  workoutInProgress: false,
  workoutElapsedSeconds: 0,
  addSet: () => {},
  clearSets: () => {},
  setWorkoutInProgress: () => {},
  setWorkoutElapsedSeconds: () => {},
};

const CurrentWorkoutContext = createContext<CurrentWorkoutContextValue>(defaultValue);

export const CurrentWorkoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sets, setSets] = useState<LoggedSet[]>([]);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);
  const [workoutElapsedSeconds, setWorkoutElapsedSeconds] = useState(0);

  const addSet = useCallback((set: LoggedSet) => {
    setSets((prev) => [...prev, set]);
  }, []);

  const clearSets = useCallback(() => {
    setSets([]);
    setWorkoutInProgress(false);
    setWorkoutElapsedSeconds(0);
  }, []);

  return (
    <CurrentWorkoutContext.Provider
      value={{
        sets,
        workoutInProgress,
        workoutElapsedSeconds,
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
