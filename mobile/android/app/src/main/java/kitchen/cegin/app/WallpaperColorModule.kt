package kitchen.cegin.app

import android.app.WallpaperManager
import android.graphics.Color
import android.os.Build
import com.facebook.react.bridge.*

class WallpaperColorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WallpaperColor"

    @ReactMethod
    fun getAccentColor(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
                promise.resolve(null)
                return
            }

            val wm = WallpaperManager.getInstance(reactApplicationContext)
            val colors = wm.getWallpaperColors(WallpaperManager.FLAG_SYSTEM)

            if (colors != null) {
                val primary = colors.primaryColor
                if (primary != null) {
                    val hex = String.format("#%06X", 0xFFFFFF and primary.toArgb())
                    promise.resolve(hex)
                    return
                }
            }

            promise.resolve(null)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }
}
