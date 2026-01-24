import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

interface CalisthenicsIconProps {
  size?: number;
  color?: string;
}

export const CalisthenicsIcon: React.FC<CalisthenicsIconProps> = ({ 
  size = 36, 
  color = '#10B981' 
}) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      {/* Head - circular, positioned upper right */}
      <Circle cx="30" cy="9" r="3.5" fill={color} />
      
      {/* Torso - rectangular, angled downward from right to left */}
      <Rect 
        x="28" 
        y="12.5" 
        width="4" 
        height="10" 
        rx="1" 
        fill={color}
        transform="rotate(-20 30 17.5)"
      />
      
      {/* Right Arm (from figure's perspective) - bent, supporting */}
      <Path
        d="M 30 12.5 L 34 19 L 36 19"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Left Arm (from figure's perspective) - bent, supporting */}
      <Path
        d="M 30 12.5 L 26 19 L 24 19"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Left Hand (on ground) */}
      <Rect x="22" y="18" width="4" height="2.5" rx="1" fill={color} />
      
      {/* Right Hand (on ground) */}
      <Rect x="34" y="18" width="4" height="2.5" rx="1" fill={color} />
      
      {/* Upper Body Segment - separated from legs */}
      <Rect 
        x="27.5" 
        y="21" 
        width="5" 
        height="5" 
        rx="1" 
        fill={color}
        transform="rotate(-20 30 23.5)"
      />
      
      {/* Lower Legs - continuing downward angle */}
      <Path
        d="M 26 25 L 22 32"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      <Path
        d="M 34 25 L 38 32"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Left Foot (toes on ground, curved) */}
      <Path
        d="M 20 32 Q 20 34 22 34"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      
      {/* Right Foot (toes on ground, curved) */}
      <Path
        d="M 40 32 Q 40 34 38 34"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
};

