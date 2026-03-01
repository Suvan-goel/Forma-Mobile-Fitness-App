import { useState, useCallback, useEffect } from 'react';
import {
  getRecordings,
  saveRecording as saveRecordingSvc,
  deleteRecording as deleteRecordingSvc,
  getRecordingForSet as getRecordingForSetSvc,
  getRecordingsForWorkout as getRecordingsForWorkoutSvc,
  linkWorkoutId as linkWorkoutIdSvc,
  getStorageUsage as getStorageUsageSvc,
  type VideoRecord,
  type VideoRecordMetadata,
} from '../services/videoLibrary';

export function useVideoLibrary() {
  const [recordings, setRecordings] = useState<VideoRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [storageInfo, setStorageInfo] = useState<{ count: number; totalSizeMB: number }>({
    count: 0,
    totalSizeMB: 0,
  });

  const refreshRecordings = useCallback(async () => {
    setIsLoading(true);
    try {
      const [records, usage] = await Promise.all([
        getRecordings(),
        getStorageUsageSvc(),
      ]);
      setRecordings(records);
      setStorageInfo(usage);
    } catch {
      // Keep existing state on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRecordings();
  }, [refreshRecordings]);

  const saveRecording = useCallback(
    async (tempUrl: string, metadata: VideoRecordMetadata): Promise<VideoRecord | null> => {
      const record = await saveRecordingSvc(tempUrl, metadata);
      if (record) {
        await refreshRecordings();
      }
      return record;
    },
    [refreshRecordings]
  );

  const deleteRecording = useCallback(
    async (id: string): Promise<void> => {
      await deleteRecordingSvc(id);
      await refreshRecordings();
    },
    [refreshRecordings]
  );

  const getRecordingForSet = useCallback(
    async (workoutId: string, exerciseName: string, setNumber: number): Promise<VideoRecord | null> => {
      return getRecordingForSetSvc(workoutId, exerciseName, setNumber);
    },
    []
  );

  const getRecordingsForWorkout = useCallback(
    async (workoutId: string): Promise<VideoRecord[]> => {
      return getRecordingsForWorkoutSvc(workoutId);
    },
    []
  );

  const linkWorkoutId = useCallback(
    async (sessionId: string, workoutId: string): Promise<void> => {
      await linkWorkoutIdSvc(sessionId, workoutId);
      await refreshRecordings();
    },
    [refreshRecordings]
  );

  return {
    recordings,
    isLoading,
    storageInfo,
    saveRecording,
    deleteRecording,
    refreshRecordings,
    getRecordingForSet,
    getRecordingsForWorkout,
    linkWorkoutId,
  };
}
