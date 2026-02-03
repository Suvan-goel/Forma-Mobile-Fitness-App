/**
 * Custom hook for workout data management
 */

import { useState, useEffect, useCallback } from 'react';
import { workoutsService, WorkoutSession, WorkoutDetails } from '../services/api';

interface UseWorkoutsReturn {
  workouts: WorkoutSession[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseWorkoutDetailsReturn {
  workout: WorkoutDetails | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useWorkouts = (): UseWorkoutsReturn => {
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkouts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await workoutsService.getAll();
      if (response.success) {
        setWorkouts(response.data);
      } else {
        setError(response.error || 'Failed to fetch workouts');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkouts();
  }, [fetchWorkouts]);

  return { workouts, isLoading, error, refetch: fetchWorkouts };
};

export const useWorkoutDetails = (workoutId: string): UseWorkoutDetailsReturn => {
  const [workout, setWorkout] = useState<WorkoutDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await workoutsService.getById(workoutId);
      if (response.success) {
        setWorkout(response.data);
      } else {
        setError(response.error || 'Failed to fetch workout details');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [workoutId]);

  useEffect(() => {
    fetchWorkout();
  }, [fetchWorkout]);

  return { workout, isLoading, error, refetch: fetchWorkout };
};
