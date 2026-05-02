export const ANDROID_NAV_BAR_MIN_HEIGHT = 8;
export const TAB_BAR_HEIGHT = 66;
export const TAB_SCREEN_BOTTOM_GAP = 32;
export const DEFAULT_BOTTOM_BREATHING_ROOM = 16;

export const getBottomSafePadding = (
  inset: number,
  min = ANDROID_NAV_BAR_MIN_HEIGHT,
) => Math.max(inset, min);

export const getBottomOverlayPadding = (
  inset: number,
  base = DEFAULT_BOTTOM_BREATHING_ROOM,
) => getBottomSafePadding(inset) + base;

export const getTabScreenBottomPadding = (
  inset: number,
  screenGap = TAB_SCREEN_BOTTOM_GAP,
) => TAB_BAR_HEIGHT + getBottomSafePadding(inset) + screenGap;
