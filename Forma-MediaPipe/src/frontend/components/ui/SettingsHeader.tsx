import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

interface SettingsHeaderProps {
  title: string;
  onBack: () => void;
  rightSlot?: React.ReactNode;
}

export const SettingsHeader: React.FC<SettingsHeaderProps> = ({
  title,
  onBack,
  rightSlot,
}) => (
  <View style={styles.header}>
    <TouchableOpacity
      onPress={onBack}
      activeOpacity={0.7}
      style={styles.backBtn}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
    </TouchableOpacity>
    <Text style={styles.headerName} numberOfLines={1} adjustsFontSizeToFit>
      {title}
    </Text>
    <View style={styles.headerSlot}>{rightSlot}</View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 12,
  },
  backBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
    flex: 1,
    textAlign: 'left',
  },
  headerSlot: {
    minWidth: 28,
    height: 32,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
