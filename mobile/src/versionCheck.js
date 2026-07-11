// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServerUrl } from './config';
import { getAppMode } from './config';

const VERSION_KEY = 'cegin_version_status';

// Current client version from app.json
export const CLIENT_VERSION = Constants.expoConfig?.version || '0.0.0';

let _status = null;

// ── Semver compare ───────────────────────────────────────────────────────────
// Returns -1 if a < b, 0 if equal, 1 if a > b
function semverCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

// ── Check versions ───────────────────────────────────────────────────────────
export async function checkVersions() {
  const mode = await getAppMode();
  if (mode !== 'server') {
    _status = { clientOutdated: false, serverOutdated: false, clientVersion: CLIENT_VERSION };
    return _status;
  }

  try {
    const base = await getServerUrl();
    if (!base) return _status;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      _status = { clientOutdated: false, serverOutdated: false, clientVersion: CLIENT_VERSION };
      return _status;
    }

    const data = await res.json();
    const { serverVersion, latestServerVersion, minClientVersion, latestClientVersion } = data;

    const clientOutdated = latestClientVersion
      ? semverCompare(CLIENT_VERSION, latestClientVersion) < 0
      : false;

    const clientTooOld = minClientVersion
      ? semverCompare(CLIENT_VERSION, minClientVersion) < 0
      : false;

    const serverOutdated = (serverVersion && latestServerVersion)
      ? semverCompare(serverVersion, latestServerVersion) < 0
      : false;

    _status = {
      clientVersion: CLIENT_VERSION,
      serverVersion: serverVersion || 'unknown',
      latestClientVersion: latestClientVersion || CLIENT_VERSION,
      minClientVersion: minClientVersion || CLIENT_VERSION,
      clientOutdated,   // newer version available
      clientTooOld,     // below minimum — may not work
      serverOutdated,   // server is behind latest release
    };

    // Cache for instant reads
    await AsyncStorage.setItem(VERSION_KEY, JSON.stringify(_status));
    return _status;
  } catch {
    // Offline or error — use cached status
    if (!_status) {
      try {
        const raw = await AsyncStorage.getItem(VERSION_KEY);
        _status = raw ? JSON.parse(raw) : null;
      } catch (_e) { if (__DEV__) console.warn(\'[versionCheck] Caught error:\', _e.message); }
    }
    return _status;
  }
}

// ── Synchronous getter ───────────────────────────────────────────────────────
export function getVersionStatus() {
  return _status;
}
