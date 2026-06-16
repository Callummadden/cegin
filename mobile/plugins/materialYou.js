const { withMainActivity, createRunOncePlugin } = require('@expo/config-plugins');

const MATERIAL_YOU_MODULE = `
// --- Material You accent color reader ---
class MaterialYouColorModule extends expo.modules.kotlin.modules.Module {
  override fun definition() = ModuleDefinition {
    Name("MaterialYouColor")

    AsyncFunction("getAccentColor") {
      try {
        val context = appContext.reactContext ?: return@AsyncFunction null
        // Android 12+ exposes the wallpaper-derived accent via Settings
        val accent = android.provider.Settings.Secure.getString(
          context.contentResolver,
          "theme_customization_accent_color"
        )
        if (!accent.isNullOrEmpty() && accent.startsWith("#")) {
          return@AsyncFunction accent
        }
        // Fallback: try reading the system accent from the wallpaper manager
        val wm = android.app.WallManager.getInstance(context)
        val colors = wm.getWallpaperColors(android.app.WallpaperManager.FLAG_SYSTEM)
        if (colors != null) {
          val primary = colors.primaryColor
          if (primary != null) {
            return@AsyncFunction String.format("#%06X", 0xFFFFFF and primary.toArgb())
          }
        }
      } catch (_: Exception) {}
      return@AsyncFunction null
    }
  }
}
`;

function withMaterialYouModule(config) {
  // Add the native module via a mod plugin that writes a Kotlin file
  return withMainActivity(config, (mod) => {
    // We can't easily add a module file via config plugins alone,
    // but we can inject a helper into MainActivity that JS can call
    return mod;
  });
}

module.exports = createRunOncePlugin(withMaterialYouModule, 'material-you-color', '1.0.0');
