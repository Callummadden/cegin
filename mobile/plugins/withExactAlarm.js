// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
const { withDangerousMod, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withExactAlarm(config) {
  // Add SCHEDULE_EXACT_ALARM permission to manifest
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const hasPerm = manifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === 'android.permission.SCHEDULE_EXACT_ALARM'
    );
    if (!hasPerm) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM' },
      });
    }
    return config;
  });

  // Write native module + package
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const pkg = 'kitchen.cegin.app';
      const pkgDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/kitchen/cegin/app'
      );
      fs.mkdirSync(pkgDir, { recursive: true });

      // Module
      fs.writeFileSync(
        path.join(pkgDir, 'ExactAlarmModule.kt'),
        `package ${pkg}

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*

class ExactAlarmModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "ExactAlarm"

  @ReactMethod
  fun canSchedule(promise: Promise) {
    val am = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    promise.resolve(am.canScheduleExactAlarms())
  }

  @ReactMethod
  fun openSettings() {
    try {
      val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = Uri.parse("package:\${reactApplicationContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
    } catch (_: Exception) {
      // Fallback for older Android versions
      try {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.parse("package:\${reactApplicationContext.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
      } catch (_: Exception) {}
    }
  }
}
`
      );

      // Package
      fs.writeFileSync(
        path.join(pkgDir, 'ExactAlarmPackage.kt'),
        `package ${pkg}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ExactAlarmPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ExactAlarmModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`
      );

      return config;
    },
  ]);

  // Register package in MainApplication
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const mainAppPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/kitchen/cegin/app/MainApplication.kt'
      );
      if (fs.existsSync(mainAppPath)) {
        let content = fs.readFileSync(mainAppPath, 'utf8');
        if (!content.includes('ExactAlarmPackage')) {
          content = content.replace(
            'add(ExpoModulesPackage())',
            'add(ExpoModulesPackage())\n          add(ExactAlarmPackage())'
          );
          fs.writeFileSync(mainAppPath, content);
        }
      }
      return config;
    },
  ]);

  return config;
};
