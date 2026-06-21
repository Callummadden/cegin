// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { Text, View } from 'react-native';
import { useTheme } from '../theme';

export default function AiDisclaimer({ style }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }, style]}>
      <Text style={{ fontSize: 10, color: colors.textMuted }}>⚠</Text>
      <Text style={{ fontSize: 10, color: colors.textMuted, flex: 1, lineHeight: 14 }}>
        AI-generated — information may be inaccurate. Always double-check.
      </Text>
    </View>
  );
}
