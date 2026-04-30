import React, { memo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Settings as SettingsIcon } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, FONTS } from '../../constants/theme';

export const HEADER_HEIGHT = 80; // Approximate height of the header

export const AppHeader: React.FC = memo(() => {
  const navigation = useNavigation<any>();

  const handleSettingsPress = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  return (
    <View style={styles.header}>
      <Text style={styles.title}>FORMA</Text>
      <TouchableOpacity style={styles.iconButton} onPress={handleSettingsPress}>
        <SettingsIcon size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 12,
  },
  title: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

