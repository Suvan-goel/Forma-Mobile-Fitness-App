/**
 * Custom hook for workout data management
 */

import { useState, useEffect, useCallback } from 'react';
import { workoutsService, WorkoutSession, WorkoutDetails } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

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
  const { user, isLoading: authLoading } = useAuth();
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkouts = useCallback(async (uid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await workoutsService.getAll(uid);
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
    if (!authLoading && user) {
      fetchWorkouts(user.id);
    } else if (!authLoading && !user) {
      setWorkouts([]);
      setIsLoading(false);
    }
  }, [authLoading, user, fetchWorkouts]);

  const refetch = useCallback(async () => {
    if (user) await fetchWorkouts(user.id);
  }, [user, fetchWorkouts]);

  return { workouts, isLoading: isLoading || authLoading, error, refetch };
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

interface UseDeleteWorkoutReturn {
  deleteWorkout: (id: string) => Promise<boolean>;
  isDeleting: boolean;
}

export const useDeleteWorkout = (): UseDeleteWorkoutReturn => {
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteWorkout = useCallback(async (id: string): Promise<boolean> => {
    setIsDeleting(true);
    try {
      const response = await workoutsService.delete(id);
      return response.success;
    } catch {
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  return { deleteWorkout, isDeleting };
};
