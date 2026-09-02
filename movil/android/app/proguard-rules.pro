# Firebase Messaging entra por reflexión desde el servicio del sistema, así que
# sus clases no pueden renombrarse ni eliminarse al ofuscar la versión release.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**

# Los avisos programados de flutter_local_notifications se reconstruyen tras un
# reinicio del teléfono a partir de estas clases.
-keep class com.dexterous.** { *; }
