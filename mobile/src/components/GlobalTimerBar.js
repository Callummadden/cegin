// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTimers } from '../timerContext';
import { MONO, useTheme } from '../theme';
import { useResponsive } from '../utils/responsive';
import { fmtClock } from '../utils/timerUtils';
import { useNavigation } from '@react-navigation/native';

export default function GlobalTimerBar() {
  const { timers, activeRecipe, activeStep, pauseTimer, resumeTimer, cancelTimer } = useTimers();
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [isCookMode, setIsCookMode] = useState(
    navigation.getState()?.routes?.[navigation.getState()?.index]?.name === 'CookMode'
  );

  useEffect(() => {
    const unsub = navigation.addListener('state', () => {
      const state = navigation.getState();
      const route = state?.routes?.[state?.index]?.name;
      setIsCookMode(route === 'CookMode');
    });
    return unsub;
  }, [navigation]);
  const styles = useMemo(() => makeStyles(colors, s, fs, insets, isCookMode), [colors, s, fs, insets, isCookMode]);

  const activeTimers = useMemo(
    () => Object.entries(timers),
    [timers]
  );

  if (activeTimers.length === 0) return null;

  const navigateToCookMode = () => {
    if (!isCookMode && activeRecipe) {
      navigation.navigate('CookMode', { recipe: activeRecipe, step: activeStep });
    }
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {activeTimers.map(([id, t]) => (
          <Pressable
            key={id}
            style={[styles.pill, { borderColor: t.done ? colors.success : t.running ? colors.primary : colors.border }]}
            onPress={navigateToCookMode}
          >
            <Text style={[styles.label, { fontFamily: MONO, color: colors.textMuted }]} numberOfLines={1}>
              {t.label}
            </Text>
            <Text style={[styles.clock, { fontFamily: MONO, color: t.done ? colors.success : colors.text }]}>
              {fmtClock(t.left)}
            </Text>
            <View style={styles.actions}>
              {t.done ? (
                <Pressable onPress={() => cancelTimer(id)} style={[styles.actionBtn, { backgroundColor: colors.success + '20', borderRadius: s(10), paddingHorizontal: s(8) }]}>
                  <Text style={[styles.actionText, { color: colors.success, fontSize: fs(10), fontWeight: '700' }]}>
                    DISMISS
                  </Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => t.running ? pauseTimer(id) : resumeTimer(id)} style={styles.actionBtn}>
                  <Text style={[styles.actionText, { color: colors.primary }]}>
                    {t.running ? '⏸' : '▶'}
                  </Text>
                </Pressable>
              )}
              <Pressable onPress={() => cancelTimer(id)} style={styles.actionBtn}>
                <Text style={[styles.actionText, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors, s, fs, insets, isCookMode) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    ...(isCookMode
      ? { top: insets.top }
      : { bottom: 70 + Math.max(12, insets.bottom - 8) }
    ),
    zIndex: 9,
    paddingVertical: s(6),
  },
  scrollContent: {
    paddingHorizontal: s(12),
    alignItems: 'center',
    gap: s(8),
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: s(20),
    paddingLeft: s(12),
    paddingRight: s(8),
    paddingVertical: s(6),
    gap: s(8),
    backgroundColor: colors.surface,
  },
  label: { fontSize: fs(10), letterSpacing: 0.5, maxWidth: s(80) },
  clock: { fontSize: fs(14), fontWeight: '700' },
  actions: { flexDirection: 'row', gap: s(2) },
  actionBtn: { padding: s(4) },
  actionText: { fontSize: fs(14) },
});
