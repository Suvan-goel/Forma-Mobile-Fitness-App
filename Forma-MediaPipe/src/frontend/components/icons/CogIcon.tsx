import React from 'react';
import { Image, StyleSheet } from 'react-native';

type Props = {
  size?: number;
  color?: string;
};

const SETTINGS_ICON = require('../../assets/generated/settings-icon.png');

export default function CogIcon({ size = 22, color = '#FFFFFF' }: Props) {
  return (
    <Image
      source={SETTINGS_ICON}
      resizeMode="contain"
      style={[
        styles.icon,
        {
          width: size,
          height: size,
          tintColor: color === 'currentColor' ? undefined : color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  icon: {
    flexShrink: 0,
  },
});
