import React, { useCallback } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONTS } from '../../constants/theme';

interface RecordingPlaybackModalProps {
  videoPath: string;
  onClose: () => void;
}

export const RecordingPlaybackModal: React.FC<RecordingPlaybackModalProps> = ({
  videoPath,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(videoPath, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.staysActiveInBackground = false;
    videoPlayer.play();
  });

  const handleClose = useCallback(() => {
    try {
      player.pause();
    } catch {}
    onClose();
  }, [onClose, player]);

  useEventListener(player, 'playToEnd', handleClose);

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.playerContainer}>
        <VideoView
          player={player}
          style={styles.player}
          nativeControls
          contentFit="contain"
          surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
        />
        <TouchableOpacity
          style={[styles.playerClose, { top: insets.top + 10 }]}
          onPress={handleClose}
        >
          <Text style={styles.playerCloseText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playerCloseText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
});
