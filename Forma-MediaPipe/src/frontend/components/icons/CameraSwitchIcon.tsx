import React from 'react';
import Svg, { Path } from 'react-native-svg';

type Props = {
  width?: number;
  height?: number;
  color?: string;
};

/**
 * Camera flip / rotate clockwise icon.
 * Replace the <Path> elements with your downloaded SVG path data if needed.
 */
export default function CameraSwitchIcon({
  width = 24,
  height = 24,
  color = 'currentColor',
}: Props) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <Path d="M21 3v5h-5" />
    </Svg>
  );
}
