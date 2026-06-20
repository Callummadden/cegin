package kitchen.cegin.app

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
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
    } catch (_: Exception) {
      // Fallback for older Android versions
      try {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.parse("package:${reactApplicationContext.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
      } catch (_: Exception) {}
    }
  }
}
