// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_KT = `package kitchen.cegin.app

import android.app.WallpaperManager
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MaterialYouModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "MaterialYouColor"

  @ReactMethod
  fun getAccentColor(promise: Promise) {
    try {
      val context = reactApplicationContext

      // Android 12+ exposes the wallpaper-derived accent via Settings
      val accent = Settings.Secure.getString(
        context.contentResolver,
        "theme_customization_accent_color"
      )
      if (!accent.isNullOrEmpty() && accent.startsWith("#")) {
        promise.resolve(accent)
        return
      }

      // Fallback: try reading from WallpaperManager
      if (Build.VERSION.SDK_INT >= 27) {
        val wm = WallpaperManager.getInstance(context)
        val colors = wm.getWallpaperColors(WallpaperManager.FLAG_SYSTEM)
        if (colors != null) {
          val primary = colors.primaryColor
          if (primary != null) {
            promise.resolve(String.format("#%06X", 0xFFFFFF and primary.toArgb()))
            return
          }
        }
      }
    } catch (_: Exception) {}
    promise.resolve(null)
  }
}
`;

const PACKAGE_KT = `package kitchen.cegin.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MaterialYouPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(MaterialYouModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

function withMaterialYouModule(config) {
  // Write the Kotlin source files
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const pkg = config.modRequest.packageName || 'kitchen.cegin.app';
      const moduleDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/' + pkg.replace(/\./g, '/')
      );
      fs.mkdirSync(moduleDir, { recursive: true });
      fs.writeFileSync(path.join(moduleDir, 'MaterialYouModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(moduleDir, 'MaterialYouPackage.kt'), PACKAGE_KT);
      return config;
    },
  ]);

  // Register the package in MainApplication.kt
  config = withMainApplication(config, (config) => {
    if (!config.modResults.contents.includes('MaterialYouPackage')) {
      config.modResults.contents = config.modResults.contents.replace(
        /packages\.apply\s*\{/,
        `packages.apply {\n          add(MaterialYouPackage())`
      );
    }
    return config;
  });

  return config;
}

module.exports = withMaterialYouModule;
