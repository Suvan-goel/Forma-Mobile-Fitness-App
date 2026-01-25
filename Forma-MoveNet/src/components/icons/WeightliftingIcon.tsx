import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

interface WeightliftingIconProps {
  size?: number;
  color?: string;
}

export const WeightliftingIcon: React.FC<WeightliftingIconProps> = ({ 
  size = 36, 
  color = '#10B981' 
}) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      {/* Head - circular, larger */}
      <Circle cx="20" cy="8" r="3.5" fill={color} />
      
      {/* Torso - rectangular, cleaner proportions */}
      <Rect x="17.5" y="11.5" width="5" height="9" rx="1" fill={color} />
      
      {/* Left Arm (extended straight up) - thicker, cleaner */}
      <Path
        d="M 12 11.5 L 12 2.5"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Right Arm (extended straight up) - thicker, cleaner */}
      <Path
        d="M 28 11.5 L 28 2.5"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Barbell Bar - horizontal bar, thicker */}
      <Rect x="10" y="2" width="20" height="2" rx="1" fill={color} />
      
      {/* Left Weight Plate - rectangular with rounded corners, larger */}
      <Rect x="2" y="0.5" width="9" height="5" rx="1.5" fill={color} />
      
      {/* Right Weight Plate - rectangular with rounded corners, larger */}
      <Rect x="29" y="0.5" width="9" height="5" rx="1.5" fill={color} />
      
      {/* Left Leg - wide stance, bent, thicker */}
      <Path
        d="M 17.5 20.5 L 11 30"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Right Leg - wide stance, bent, thicker */}
      <Path
        d="M 22.5 20.5 L 29 30"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Left Foot - larger */}
      <Rect x="8" y="30" width="5" height="2" rx="1" fill={color} />
      
      {/* Right Foot - larger */}
      <Rect x="27" y="30" width="5" height="2" rx="1" fill={color} />
    </Svg>
  );
};

