// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useEffect, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

const DELETE_WIDTH = 80;

const swipeStyles = StyleSheet.create({
  outer: { position: 'relative', overflow: 'hidden' },
  deleteBg: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: DELETE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    zIndex: 0,
  },
  deleteBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  deleteText: { fontWeight: '700', fontSize: 11 },
});

export default function SwipeableRow({ onDelete, children, colors }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const onDeleteRef = useRef(onDelete);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 12 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderMove: (_, gs) => {
        const next = isOpen.current ? -DELETE_WIDTH + gs.dx : gs.dx;
        translateX.setValue(Math.min(0, Math.max(-DELETE_WIDTH, next)));
      },
      onPanResponderRelease: (_, gs) => {
        const dx = isOpen.current ? -DELETE_WIDTH + gs.dx : gs.dx;
        if (dx < -60 || gs.vx < -0.5) {
          Animated.timing(translateX, { toValue: -DELETE_WIDTH, duration: 150, useNativeDriver: false }).start(() => {
            isOpen.current = false;
            translateX.setValue(0);
            onDeleteRef.current();
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
          isOpen.current = false;
        }
      },
    })
  ).current;

  const closeAndDelete = () => {
    Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
      isOpen.current = false;
      onDeleteRef.current();
    });
  };

  return (
    <View style={swipeStyles.outer}>
      <View style={[swipeStyles.deleteBg, { backgroundColor: colors?.danger || '#E5645B' }]}>
        <Pressable style={swipeStyles.deleteBtn} onPress={closeAndDelete}>
          <Text style={[swipeStyles.deleteText, { color: colors?.onPrimary || '#fff' }]}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View
        style={{ transform: [{ translateX }], backgroundColor: colors?.background || '#131010', zIndex: 1 }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}
