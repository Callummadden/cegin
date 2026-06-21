// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MONO, useTheme } from '../theme';

const TUTORIAL_KEY = 'cegin_tutorial_done';
const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

const STEPS = [
  {
    target: 'fab',
    icon: '🍽️',
    title: 'ADD RECIPES',
    desc: 'Tap the food button to add your first recipe. Import from a URL, type it in, or scan a photo.',
    position: 'above',
  },
  {
    target: 'search',
    icon: '🔍',
    title: 'SEARCH',
    desc: 'Search by recipe name, ingredient, or tag. Your recent searches are saved.',
    position: 'below',
  },
  {
    target: 'tabs',
    icon: '🏷️',
    title: 'FILTER TABS',
    desc: 'Swipe between tabs to filter by favourites, quick meals, tags, or collections.',
    position: 'below',
  },
  {
    target: 'view',
    icon: '👁️',
    title: 'CHANGE VIEW',
    desc: 'Cycle between card, list, grid, and compact views.',
    position: 'below',
  },
  {
    target: 'nav',
    icon: '🧭',
    title: 'NAVIGATE',
    desc: 'Recipes, Meal Planner, Shopping List, Terry (AI assistant), and Settings.',
    position: 'above',
  },
];

export default function TutorialOverlay({ targetRefs, onComplete }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [targetLayout, setTargetLayout] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation on the highlight ring
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // Fade in
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // Measure target element when step changes
  useEffect(() => {
    const ref = targetRefs[STEPS[step]?.target];
    if (ref?.current) {
      // Small delay to let layout settle
      const timer = setTimeout(() => {
        ref.current.measureInWindow((x, y, w, h) => {
          setTargetLayout({ x, y, w, h });
        });
      }, 100);
      return () => clearTimeout(timer);
    } else {
      // Target not found (e.g. no recipes yet, FAB still there), use fallback position
      setTargetLayout(null);
    }
  }, [step, targetRefs]);

  const handleNext = async () => {
    if (step < STEPS.length - 1) {
      setTargetLayout(null);
      setStep(step + 1);
    } else {
      await AsyncStorage.setItem(TUTORIAL_KEY, 'true');
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        onComplete();
      });
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(TUTORIAL_KEY, 'true');
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      onComplete();
    });
  };

  const current = STEPS[step];

  // Calculate tooltip position
  let tooltipTop = 200;
  let tooltipLeft = 24;
  const tooltipWidth = SCREEN_W - 48;
  const highlightStyle = {};

  if (targetLayout) {
    const pad = 12;
    highlightStyle.left = targetLayout.x - pad;
    highlightStyle.top = targetLayout.y - pad;
    highlightStyle.width = targetLayout.w + pad * 2;
    highlightStyle.height = targetLayout.h + pad * 2;
    highlightStyle.borderRadius = 14;

    if (current.position === 'above') {
      tooltipTop = targetLayout.y - 160;
      if (tooltipTop < insets.top + 10) tooltipTop = targetLayout.y + targetLayout.h + 20;
    } else {
      tooltipTop = targetLayout.y + targetLayout.h + 20;
      if (tooltipTop > SCREEN_H - 200) tooltipTop = targetLayout.y - 160;
    }
    tooltipLeft = Math.max(24, Math.min(targetLayout.x, SCREEN_W - tooltipWidth - 24));
  }

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      {/* Dark backdrop */}
      <View style={styles.backdrop} />

      {/* Highlight cutout ring */}
      {targetLayout && (
        <Animated.View
          style={[
            styles.highlight,
            highlightStyle,
            { transform: [{ scale: pulseAnim }], borderColor: colors.primary },
          ]}
        />
      )}

      {/* Tooltip card */}
      <View style={[styles.tooltip, { top: tooltipTop, left: tooltipLeft, width: tooltipWidth, backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={styles.tooltipIcon}>{current.icon}</Text>
        <Text style={[styles.tooltipTitle, { color: colors.text }]}>{current.title}</Text>
        <Text style={[styles.tooltipDesc, { color: colors.textMuted }]}>{current.desc}</Text>

        <View style={styles.tooltipFooter}>
          {/* Step dots */}
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: i === step ? colors.primary : colors.border }]} />
            ))}
          </View>

          <View style={styles.tooltipBtns}>
            <Pressable onPress={handleSkip} style={styles.skipBtn}>
              <Text style={[styles.skipText, { fontFamily: MONO, color: colors.textMuted }]}>SKIP</Text>
            </Pressable>
            <Pressable onPress={handleNext} style={[styles.nextBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.nextText, { color: colors.onPrimary }]}>
                {step < STEPS.length - 1 ? 'NEXT' : 'GOT IT'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// Check if tutorial should show
export async function shouldShowTutorial() {
  try {
    const done = await AsyncStorage.getItem(TUTORIAL_KEY);
    return !done;
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  highlight: {
    position: 'absolute',
    borderWidth: 2.5,
    borderStyle: 'dashed',
  },
  tooltip: {
    position: 'absolute',
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 20,
  },
  tooltipIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  tooltipTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tooltipDesc: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
  },
  tooltipFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tooltipBtns: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  skipText: {
    fontSize: 11,
    letterSpacing: 1,
  },
  nextBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  nextText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
