/**
 * Video Library Storage Service
 *
 * Manages persistent on-device storage of recorded workout videos.
 * Videos are stored in documentDirectory/recordings/.
 * Metadata is indexed in AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

let FileSystem: any = null;
let VideoThumbnails: any = null;

try {
  FileSystem = require('expo-file-system');
  VideoThumbnails = require('expo-video-thumbnails');
} catch (error) {
  console.warn('Video library: native modules not available:', error);
}

const STORAGE_KEY = '@forma/video_library';
const RECORDINGS_DIR = 'recordings/';
const THUMBNAILS_DIR = 'recordings/thumbnails/';

export interface VideoRecord {
  id: string;
  sessionId: string;
  workoutId?: string;
  exerciseName: string;
  setNumber: number;
  date: string;
  durationSeconds: number;
  formScore: number;
  reps: number;
  videoPath: string;
  thumbnailPath: string;
}

export interface VideoRecordMetadata {
  sessionId: string;
  exerciseName: string;
  setNumber: number;
  durationSeconds: number;
  formScore: number;
  reps: number;
}

/** Generate a simple UUID */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Ensure recording directories exist */
async function ensureDirectories(): Promise<void> {
  if (!FileSystem) return;
  const baseDir = FileSystem.documentDirectory + RECORDINGS_DIR;
  const thumbDir = FileSystem.documentDirectory + THUMBNAILS_DIR;

  const baseInfo = await FileSystem.getInfoAsync(baseDir);
  if (!baseInfo.exists) {
    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
  }

  const thumbInfo = await FileSystem.getInfoAsync(thumbDir);
  if (!thumbInfo.exists) {
    await FileSystem.makeDirectoryAsync(thumbDir, { intermediates: true });
  }
}

/** Read all records from AsyncStorage */
async function readRecords(): Promise<VideoRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Write all records to AsyncStorage */
async function writeRecords(records: VideoRecord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/**
 * Save a recording from a temp URL to permanent storage.
 * Generates a thumbnail and stores metadata.
 */
export async function saveRecording(
  tempUrl: string,
  metadata: VideoRecordMetadata
): Promise<VideoRecord | null> {
  if (!FileSystem) return null;

  try {
    await ensureDirectories();

    const id = generateId();
    const ext = tempUrl.includes('.mp4') ? '.mp4' : '.mp4';
    const videoFilename = `${id}${ext}`;
    const videoPath = FileSystem.documentDirectory + RECORDINGS_DIR + videoFilename;

    // Ensure the temp path has a file:// URI scheme — HBRecorder on Android
    // returns a raw filesystem path without the prefix.
    const fromUri = tempUrl.startsWith('file://') ? tempUrl : `file://${tempUrl}`;

    // Copy video from temp to permanent storage, then delete the temp file.
    // moveAsync fails on Android when crossing storage boundaries (external → internal).
    await FileSystem.copyAsync({ from: fromUri, to: videoPath });
    FileSystem.deleteAsync(fromUri, { idempotent: true }).catch(() => {});

    // Generate thumbnail
    let thumbnailPath = '';
    if (VideoThumbnails) {
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(videoPath, {
          time: 1000, // 1 second in
          quality: 0.5,
        });
        const thumbFilename = `${id}.jpg`;
        const thumbDest = FileSystem.documentDirectory + THUMBNAILS_DIR + thumbFilename;
        await FileSystem.moveAsync({ from: thumb.uri, to: thumbDest });
        thumbnailPath = thumbDest;
      } catch {
        // Thumbnail generation failed — record still saved
      }
    }

    const record: VideoRecord = {
      id,
      sessionId: metadata.sessionId,
      exerciseName: metadata.exerciseName,
      setNumber: metadata.setNumber,
      date: new Date().toISOString(),
      durationSeconds: metadata.durationSeconds,
      formScore: metadata.formScore,
      reps: metadata.reps,
      videoPath,
      thumbnailPath,
    };

    const records = await readRecords();
    records.unshift(record); // Newest first
    await writeRecords(records);

    return record;
  } catch (error) {
    console.warn('Video library: failed to save recording:', error);
    return null;
  }
}

/**
 * Get all saved recordings, newest first.
 */
export async function getRecordings(): Promise<VideoRecord[]> {
  return readRecords();
}

/**
 * Get a specific recording for a set within a workout.
 */
export async function getRecordingForSet(
  workoutId: string,
  exerciseName: string,
  setNumber: number
): Promise<VideoRecord | null> {
  const records = await readRecords();
  return records.find(
    (r) => r.workoutId === workoutId && r.exerciseName === exerciseName && r.setNumber === setNumber
  ) ?? null;
}

/**
 * Get all recordings linked to a workout.
 */
export async function getRecordingsForWorkout(
  workoutId: string
): Promise<VideoRecord[]> {
  const records = await readRecords();
  return records.filter((r) => r.workoutId === workoutId);
}

/**
 * Link all recordings with a given sessionId to a workoutId.
 * Called after the workout is saved to the DB.
 */
export async function linkWorkoutId(
  sessionId: string,
  workoutId: string
): Promise<void> {
  const records = await readRecords();
  let changed = false;
  for (const record of records) {
    if (record.sessionId === sessionId && !record.workoutId) {
      record.workoutId = workoutId;
      changed = true;
    }
  }
  if (changed) {
    await writeRecords(records);
  }
}

/**
 * Delete a recording and its associated files.
 */
export async function deleteRecording(id: string): Promise<void> {
  if (!FileSystem) return;

  const records = await readRecords();
  const record = records.find((r) => r.id === id);
  if (!record) return;

  // Delete video file
  try {
    const videoInfo = await FileSystem.getInfoAsync(record.videoPath);
    if (videoInfo.exists) {
      await FileSystem.deleteAsync(record.videoPath, { idempotent: true });
    }
  } catch {
    // Best-effort
  }

  // Delete thumbnail
  if (record.thumbnailPath) {
    try {
      const thumbInfo = await FileSystem.getInfoAsync(record.thumbnailPath);
      if (thumbInfo.exists) {
        await FileSystem.deleteAsync(record.thumbnailPath, { idempotent: true });
      }
    } catch {
      // Best-effort
    }
  }

  // Remove from index
  const updated = records.filter((r) => r.id !== id);
  await writeRecords(updated);
}

/**
 * Get storage usage info for the video library.
 */
export async function getStorageUsage(): Promise<{ count: number; totalSizeMB: number }> {
  if (!FileSystem) return { count: 0, totalSizeMB: 0 };

  const records = await readRecords();
  let totalBytes = 0;

  for (const record of records) {
    try {
      const info = await FileSystem.getInfoAsync(record.videoPath, { size: true });
      if (info.exists && info.size) {
        totalBytes += info.size;
      }
    } catch {
      // Skip
    }
  }

  return {
    count: records.length,
    totalSizeMB: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
  };
}
