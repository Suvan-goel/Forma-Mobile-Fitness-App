import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Trash2, Play, HardDrive } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { useVideoLibrary } from '../../backend/hooks/useVideoLibrary';
import type { VideoRecord } from '../../backend/services/videoLibrary';

let VideoComponent: any = null;
try {
  VideoComponent = require('expo-av').Video;
} catch {
  // expo-av Video not available
}

export const VideoLibraryScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { recordings, isLoading, storageInfo, deleteRecording, refreshRecordings } = useVideoLibrary();
  const [playingVideo, setPlayingVideo] = useState<VideoRecord | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshRecordings();
    }, [refreshRecordings])
  );

  const handleDelete = useCallback((record: VideoRecord) => {
    Alert.alert(
      'Delete Recording',
      `Delete this ${record.exerciseName} recording?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteRecording(record.id),
        },
      ]
    );
  }, [deleteRecording]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return '#34D399';
    if (score >= 70) return COLORS.yellow;
    return '#EF4444';
  };

  const renderItem = useCallback(({ item }: { item: VideoRecord }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => setPlayingVideo(item)}
      onLongPress={() => handleDelete(item)}
    >
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardEdge}>
          {item.thumbnailPath ? (
            <Image source={{ uri: item.thumbnailPath }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <Play size={24} color={COLORS.textTertiary} strokeWidth={1.5} />
            </View>
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.cardExercise} numberOfLines={1}>{item.exerciseName}</Text>
            <Text style={styles.cardMeta}>
              {formatDate(item.date)} · {formatDuration(item.durationSeconds)} · {item.reps} reps
            </Text>
            <View style={styles.scoreBadge}>
              <MonoText style={[styles.scoreText, { color: getScoreColor(item.formScore) }]}>
                {item.formScore}
              </MonoText>
            </View>
          </View>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Trash2 size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  ), [handleDelete]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color={COLORS.text} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Video Library</Text>
        <View style={styles.storageBadge}>
          <HardDrive size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
          <Text style={styles.storageText}>
            {storageInfo.count} · {storageInfo.totalSizeMB} MB
          </Text>
        </View>
      </View>

      {/* List */}
      {recordings.length === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <Play size={48} color={COLORS.textTertiary} strokeWidth={1} />
          <Text style={styles.emptyTitle}>No recordings yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap the video icon in the camera screen to record your sets
          </Text>
        </View>
      ) : (
        <FlatList
          data={recordings}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Video Playback Modal */}
      {playingVideo && VideoComponent && (
        <Modal
          visible={!!playingVideo}
          animationType="fade"
          onRequestClose={() => setPlayingVideo(null)}
        >
          <View style={styles.playerContainer}>
            <VideoComponent
              source={{ uri: playingVideo.videoPath }}
              style={styles.player}
              useNativeControls
              shouldPlay
              resizeMode="contain"
              onPlaybackStatusUpdate={(status: any) => {
                if (status.didJustFinish) setPlayingVideo(null);
              }}
            />
            <TouchableOpacity
              style={[styles.playerClose, { top: insets.top + 10 }]}
              onPress={() => setPlayingVideo(null)}
            >
              <Text style={styles.playerCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  backButton: {
    marginRight: SPACING.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  storageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  storageText: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  list: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  cardGradient: {
    borderRadius: 16,
  },
  cardEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    gap: SPACING.sm,
  },
  thumbnail: {
    width: 72,
    height: 96,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    gap: 3,
  },
  cardExercise: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  cardMeta: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  scoreBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  scoreText: {
    fontSize: 18,
    letterSpacing: -0.5,
  },
  deleteButton: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: SPACING.sm,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    marginTop: SPACING.md,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
  playerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  player: {
    flex: 1,
  },
  playerClose: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playerCloseText: {
    fontSize: 15,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});
