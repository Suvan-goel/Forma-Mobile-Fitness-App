import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { COLORS, FONTS } from '../constants/theme';

export type AlertButton = {
  text: string;
  style?: 'cancel' | 'destructive' | 'default';
  onPress?: () => void;
};

type AlertConfig = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

type AlertContextValue = {
  showAlert: (title: string, message?: string, buttons?: AlertButton[]) => void;
};

const AlertContext = createContext<AlertContextValue>({ showAlert: () => {} });

const DEFAULT_BUTTON: AlertButton = { text: 'OK', style: 'default' };

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const showAlert = useCallback((
    title: string,
    message?: string,
    buttons?: AlertButton[],
  ) => {
    const resolvedButtons = (buttons && buttons.length > 0) ? buttons : [DEFAULT_BUTTON];
    setConfig({ title, message, buttons: resolvedButtons });
    scaleAnim.setValue(0.9);
    opacityAnim.setValue(0);
    setVisible(true);
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 22,
        stiffness: 320,
        mass: 0.8,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  const dismiss = useCallback((callback?: () => void) => {
    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      setConfig(null);
      callback?.();
    });
  }, [opacityAnim]);

  const btns = config?.buttons ?? [];
  const cancelBtn = btns.find(b => b.style === 'cancel');
  const actionBtns = btns.filter(b => b.style !== 'cancel');
  const isTwoButton = !!cancelBtn && actionBtns.length > 0;

  return (
    <AlertContext.Provider value={{ showAlert }}>
      <View style={{ flex: 1 }}>
        {children}
        {visible && (
          <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
            <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
              <Text style={styles.title}>{config?.title}</Text>
              {config?.message ? (
                <Text style={styles.message}>{config.message}</Text>
              ) : null}
              <View style={styles.divider} />
              {isTwoButton ? (
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.button, styles.buttonCancel]}
                    onPress={() => dismiss(cancelBtn?.onPress)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.buttonTextCancel}>{cancelBtn?.text}</Text>
                  </TouchableOpacity>
                  {actionBtns.map((btn, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.button,
                        btn.style === 'destructive' ? styles.buttonDestructive : styles.buttonPrimary,
                      ]}
                      onPress={() => dismiss(btn.onPress)}
                      activeOpacity={0.75}
                    >
                      <Text style={[
                        styles.buttonText,
                        btn.style === 'destructive' ? styles.buttonTextDestructive : styles.buttonTextPrimary,
                      ]}>
                        {btn.text}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View>
                  {btns.map((btn, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.buttonFull,
                        btn.style === 'destructive' ? styles.buttonDestructive : styles.buttonPrimary,
                      ]}
                      onPress={() => dismiss(btn.onPress)}
                      activeOpacity={0.75}
                    >
                      <Text style={[
                        styles.buttonText,
                        btn.style === 'destructive' ? styles.buttonTextDestructive : styles.buttonTextPrimary,
                      ]}>
                        {btn.text}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </Animated.View>
          </Animated.View>
        )}
      </View>
    </AlertContext.Provider>
  );
};

export const useAlert = () => useContext(AlertContext);

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlayBackground,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.cardBackgroundLight,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 32,
      },
      android: { elevation: 16 },
    }),
  },
  title: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  message: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: '#A1A1AA',
    textAlign: 'center',
    lineHeight: 21,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginTop: 22,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonFull: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.45,
        shadowRadius: 10,
      },
      android: { elevation: 5 },
    }),
  },
  buttonDestructive: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  buttonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  buttonTextPrimary: {
    color: '#FFFFFF',
  },
  buttonTextDestructive: {
    color: '#EF4444',
  },
  buttonTextCancel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    letterSpacing: 0.2,
    color: '#A1A1AA',
  },
});
