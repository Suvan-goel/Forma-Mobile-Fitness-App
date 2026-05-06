import React from 'react';
import { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { AppHeader } from './AppHeader';

interface SettingsHeaderProps {
  title: string;
  onBack: () => void;
  rightSlot?: React.ReactNode;
  titleStyle?: StyleProp<TextStyle>;
  backButtonStyle?: StyleProp<ViewStyle>;
}

export const SettingsHeader: React.FC<SettingsHeaderProps> = ({
  title,
  onBack,
  rightSlot,
  titleStyle,
  backButtonStyle,
}) => (
  <AppHeader
    title={title}
    onBack={onBack}
    rightSlot={rightSlot}
    titleStyle={titleStyle}
    backButtonStyle={backButtonStyle}
    numberOfLines={1}
    adjustsFontSizeToFit
  />
);
