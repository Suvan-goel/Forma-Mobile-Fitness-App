import React, { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import { Animated, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

interface ScrollContextValue {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  resetHeader: () => void;
  lastScrollY: React.MutableRefObject<number>;
  scrollDirection: React.MutableRefObject<'up' | 'down' | 'none'>;
  headerTranslateY: Animated.Value;
  contentMarginTop: Animated.Value;
}

const ScrollContext = createContext<ScrollContextValue | undefined>(undefined);

// Export the context itself for optional usage
export { ScrollContext };

export const HEADER_MAX_SCROLL = 80; // Maximum distance to scroll before fully hiding header
const SCROLL_UP_THRESHOLD = 50; // Pixels user must scroll up before header reappears
const ANIMATION_DURATION = 150; // Animation duration in milliseconds

export const ScrollProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const contentMarginTop = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const scrollUpStartY = useRef(0); // Track position when user starts scrolling up
  const scrollDirection = useRef<'up' | 'down' | 'none'>('none');
  const isHeaderHidden = useRef(false);

  // Collapsible header disabled: scroll handler is a no-op so header stays static and scrolls with page content
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentScrollY = event.nativeEvent.contentOffset.y;
    lastScrollY.current = currentScrollY;
  }, []);

  const resetHeader = useCallback(() => {
    // Reset header to visible state
    headerTranslateY.setValue(0);
    contentMarginTop.setValue(0);
    isHeaderHidden.current = false;
    lastScrollY.current = 0;
    scrollUpStartY.current = 0;
    scrollDirection.current = 'none';
  }, [headerTranslateY, contentMarginTop]);

  return (
    <ScrollContext.Provider
      value={{
        onScroll,
        resetHeader,
        lastScrollY,
        scrollDirection,
        headerTranslateY,
        contentMarginTop,
      }}
    >
      {children}
    </ScrollContext.Provider>
  );
};

export const useScroll = () => {
  const context = useContext(ScrollContext);
  if (!context) {
    throw new Error('useScroll must be used within a ScrollProvider');
  }
  return context;
};
