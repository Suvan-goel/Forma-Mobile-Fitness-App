import React from 'react';
import { AppHeader } from './AppHeader';

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
  <AppHeader
    title={title}
    onBack={onBack}
    rightSlot={rightSlot}
    numberOfLines={1}
    adjustsFontSizeToFit
  />
);
