import React from 'react';
import Svg, { Path } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;
};

export default function PauseIcon({ size = 24, color = 'currentColor' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill={color}>
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.05 2.75a.55.55 0 0 0-1.1 0v9.5a.55.55 0 0 0 1.1 0v-9.5Zm4 0a.55.55 0 0 0-1.1 0v9.5a.55.55 0 0 0 1.1 0v-9.5Z"
      />
    </Svg>
  );
}
