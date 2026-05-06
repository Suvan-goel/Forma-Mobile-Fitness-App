import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  Pressable,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { COLORS, PAGE_TITLE_TEXT, SPACING } from '../../constants/theme';

interface AppHeaderProps extends Pick<TextProps, 'adjustsFontSizeToFit' | 'numberOfLines'> {
  title: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  titlePrefix?: React.ReactNode;
  topInset?: number;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  backButtonStyle?: StyleProp<ViewStyle>;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  onBack,
  rightSlot,
  titlePrefix,
  topInset,
  style,
  titleStyle,
  backButtonStyle,
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
      <Pressable
        onPress={onBack}
        android_ripple={null}
        style={({ pressed }) => [
          styles.backBtn,
          pressed && styles.headerIconPressed,
          backButtonStyle,
        ]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
      </Pressable>
    ) : null}

    <View style={styles.titleRow}>
      {titlePrefix ? <View style={styles.titlePrefix}>{titlePrefix}</View> : null}
      <Text
        style={[styles.title, titleStyle]}
        numberOfLines={numberOfLines}
        adjustsFontSizeToFit={adjustsFontSizeToFit}
      >
        {title.toUpperCase()}
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
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  headerIconPressed: {
    opacity: 0.7,
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
    ...PAGE_TITLE_TEXT,
    textAlign: 'left',
  },
  rightSlot: {
    minWidth: 28,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
