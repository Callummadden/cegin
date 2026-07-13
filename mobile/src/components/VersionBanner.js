// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MONO, useTheme } from '../theme';
import { checkVersions, getVersionStatus, CLIENT_VERSION } from '../versionCheck';

export default function VersionBanner() {
  const { colors } = useTheme();
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Check on mount and when screen regains focus — no polling needed
  useEffect(() => { checkVersions().then(setStatus); }, []);
  useFocusEffect(() => { checkVersions().then(setStatus); });

  if (!status || dismissed) return null;

  // Client is below minimum — blocking warning
  if (status.clientTooOld) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.danger || '#D32F2F' }]}>
        <Text style={[styles.bannerText, { color: colors.text || '#fff' }]}>
          ⚠️ App update required (v{CLIENT_VERSION} → v{status.minClientVersion}+)
        </Text>
        <Text style={[styles.bannerSub, { color: colors.textMuted || 'rgba(255,255,255,0.7)' }]}>
          This version may not work correctly with the server.
        </Text>
        <Pressable onPress={() => setDismissed(true)} style={styles.dismiss} hitSlop={8}>
          <Text style={[styles.dismissText, { color: colors.text || '#fff' }]}>✕</Text>
        </Pressable>
      </View>
    );
  }

  // Client is outdated but still functional
  if (status.clientOutdated) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}>
        <Text style={[styles.bannerText, { color: colors.text }]}>
          Update available: v{CLIENT_VERSION} → v{status.latestClientVersion}
        </Text>
        <Pressable onPress={() => setDismissed(true)} style={styles.dismiss} hitSlop={8}>
          <Text style={[styles.dismissText, { color: colors.textMuted }]}>✕</Text>
        </Pressable>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bannerSub: {
    fontSize: 11,
    marginTop: 2,
  },
  dismiss: {
    position: 'absolute',
    right: 12,
    top: 10,
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
