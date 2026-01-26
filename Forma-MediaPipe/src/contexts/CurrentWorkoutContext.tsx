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
  addSet: (set: LoggedSet) => void;
  clearSets: () => void;
};

const defaultValue: CurrentWorkoutContextValue = {
  sets: [],
  addSet: () => {},
  clearSets: () => {},
};

const CurrentWorkoutContext = createContext<CurrentWorkoutContextValue>(defaultValue);

export const CurrentWorkoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sets, setSets] = useState<LoggedSet[]>([]);

  const addSet = useCallback((set: LoggedSet) => {
    setSets((prev) => [...prev, set]);
  }, []);

  const clearSets = useCallback(() => {
    setSets([]);
  }, []);

  return (
    <CurrentWorkoutContext.Provider value={{ sets, addSet, clearSets }}>
      {children}
    </CurrentWorkoutContext.Provider>
  );
};

export const useCurrentWorkout = (): CurrentWorkoutContextValue => {
  return useContext(CurrentWorkoutContext);
};
