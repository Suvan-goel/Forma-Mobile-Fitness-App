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
  addSet: (set: LoggedSet) => void;
  clearSets: () => void;
  setWorkoutInProgress: (value: boolean) => void;
};

const defaultValue: CurrentWorkoutContextValue = {
  sets: [],
  workoutInProgress: false,
  addSet: () => {},
  clearSets: () => {},
  setWorkoutInProgress: () => {},
};

const CurrentWorkoutContext = createContext<CurrentWorkoutContextValue>(defaultValue);

export const CurrentWorkoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sets, setSets] = useState<LoggedSet[]>([]);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);

  const addSet = useCallback((set: LoggedSet) => {
    setSets((prev) => [...prev, set]);
  }, []);

  const clearSets = useCallback(() => {
    setSets([]);
    setWorkoutInProgress(false);
  }, []);

  return (
    <CurrentWorkoutContext.Provider
      value={{ sets, workoutInProgress, addSet, clearSets, setWorkoutInProgress }}
    >
      {children}
    </CurrentWorkoutContext.Provider>
  );
};

export const useCurrentWorkout = (): CurrentWorkoutContextValue => {
  return useContext(CurrentWorkoutContext);
};
