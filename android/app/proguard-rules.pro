# R8 rules for the release build.
#
# The Kotlin here is a WebView shell, so shrinking is not about this app's own
# code -- it is about the androidx libraries behind it. appcompat, webkit and
# work-runtime (which drags in coroutines, lifecycle and Room) are the bulk of
# the dex, and almost none of that surface is reachable from a single activity.

# The JavaScript bridges. R8 sees three inner classes that Kotlin never calls and
# whose methods are only ever invoked by name from JS, so without this it strips
# them and every AndroidBars/AndroidUpdate/AndroidNotify call in the page turns
# into "not a function" at runtime -- with no build error to warn anyone.
#
# proguard-android-optimize.txt already carries the annotation-based rule; this
# restates it and pins the classes themselves, because the annotation rule keeps
# methods in a class that survived, not the class.
-keep class com.alekweather.app.MainActivity$BarsBridge { *; }
-keep class com.alekweather.app.MainActivity$Updater { *; }
-keep class com.alekweather.app.MainActivity$NotifyBridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# WorkManager instantiates workers reflectively from a class name it persisted,
# so the constructor has to survive under its original name or a job scheduled by
# an older install fails to inflate after an update. androidx ships consumer
# rules covering its own internals; this is for the worker in this app.
-keep class com.alekweather.app.WeatherCheckWorker { <init>(...); }

# Keeps line numbers in a crash report meaningful after shrinking.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
