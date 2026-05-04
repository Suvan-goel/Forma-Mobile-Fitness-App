import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

interface AppHeaderProps extends Pick<TextProps, 'adjustsFontSizeToFit' | 'numberOfLines'> {
  title: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  titlePrefix?: React.ReactNode;
  topInset?: number;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  onBack,
  rightSlot,
  titlePrefix,
  topInset,
  style,
  titleStyle,
  adjustsFontSizeToFit,
  numberOfLines = 1,
}) => (
  <View
    style={[
      styles.header,
      topInset !== undefined && { paddingTop: topInset + 4 },
      style,
    ]}
  >
    {onBack ? (
      <TouchableOpacity
        onPress={onBack}
        activeOpacity={0.7}
        style={styles.backBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
      </TouchableOpacity>
    ) : null}

    <View style={styles.titleRow}>
      {titlePrefix ? <View style={styles.titlePrefix}>{titlePrefix}</View> : null}
      <Text
        style={[styles.title, titlePrefix ? styles.brandTitle : null, titleStyle]}
        numberOfLines={numberOfLines}
        adjustsFontSizeToFit={adjustsFontSizeToFit}
      >
        {title}
      </Text>
    </View>

    <View style={styles.rightSlot}>{rightSlot}</View>
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
  titleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  titlePrefix: {
    flexShrink: 0,
    marginRight: 2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONTS.display.semibold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: 0.2,
    textAlign: 'left',
  },
  brandTitle: {
    fontFamily: FONTS.brand.semibold,
    fontSize: 22,
    letterSpacing: 4.4,
  },
  rightSlot: {
    minWidth: 28,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
