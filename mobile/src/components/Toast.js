import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MONO, useTheme } from '../theme';

const ToastContext = createContext({ showToast: () => {} });

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const showToast = useCallback((messageOrOpts) => {
    clearTimeout(timer.current);
    const opts = typeof messageOrOpts === 'string'
      ? { message: messageOrOpts }
      : messageOrOpts;
    setToast(opts);
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    const duration = opts.duration ?? 2000;
    timer.current = setTimeout(() => {
      if (!mountedRef.current) return;
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => { if (mountedRef.current) setToast(null); });
    }, duration);
  }, [opacity, mountedRef]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast
          message={toast.message}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          color={toast.color}
          opacity={opacity}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

function Toast({ message, actionLabel, onAction, color, opacity }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          bottom: 60 + insets.bottom,
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.row}>
        <Text style={[styles.text, { color: color || colors.text }]}>{message}</Text>
        {actionLabel && (
          <Pressable
            onPress={() => {
              if (onAction) onAction();
            }}
            hitSlop={8}
            style={styles.actionBtn}
          >
            <Text style={[styles.actionText, { color: colors.primary }]}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  text: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  actionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actionText: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
