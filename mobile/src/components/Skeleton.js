import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

function usePulse() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  const animRef = useRef(null);
  useEffect(() => {
    animRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    animRef.current.start();
    return () => { animRef.current?.stop(); animRef.current = null; };
  }, [opacity]);
  return opacity;
}

export function TextSkeleton({ width = '100%', height = 14, style }) {
  const { colors } = useTheme();
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: 6,
          backgroundColor: colors.surface2,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function RecipeCardSkeleton() {
  const { colors } = useTheme();
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: colors.surface2, opacity },
      ]}
    >
      <View style={styles.cardFooter}>
        <View style={[styles.line, { backgroundColor: colors.surface }]} />
        <View style={[styles.lineShort, { backgroundColor: colors.surface }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 200,
    borderRadius: 18,
    marginBottom: 14,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  cardFooter: {
    paddingHorizontal: 16,
    paddingBottom: 13,
    paddingTop: 24,
    gap: 8,
  },
  line: {
    height: 18,
    borderRadius: 6,
    width: '70%',
  },
  lineShort: {
    height: 12,
    borderRadius: 6,
    width: '45%',
  },
});
