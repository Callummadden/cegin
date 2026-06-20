package kitchen.cegin.app

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
