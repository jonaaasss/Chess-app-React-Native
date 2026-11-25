// The (i) icon: drawn as SVG (Unicode ⓘ doesn't center reliably).
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme';

export function InfoIcon({ size = 16, color = colors.textDim }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} fill="none" />
      <Path d="M12 10.5v6.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={12} cy={7.2} r={1.5} fill={color} />
    </Svg>
  );
}
