package com.cinemuah.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/** Keeps the process alive (with a notification) while downloads are running in the background. */
public class DownloadService extends Service {
    private static final String CHANNEL = "downloads";
    private static final int NOTIFICATION_ID = 1;
    private static volatile boolean running;
    private PowerManager.WakeLock wakeLock;

    /** Starts the service when downloads are active and stops it when they are not. */
    public static void sync(Context ctx, int active) {
        try {
            if (active > 0) {
                Intent i = new Intent(ctx, DownloadService.class).putExtra("count", active);
                ContextCompat.startForegroundService(ctx, i);
            } else if (running) {
                ctx.stopService(new Intent(ctx, DownloadService.class));
            }
        } catch (Exception ignored) {
            // Starting a foreground service from the background can be refused on newer Android; downloads still run while the app is open
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        int count = intent != null ? intent.getIntExtra("count", 1) : 1;
        running = true;

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Cinemuah")
                .setContentText(count == 1 ? "Downloading 1 title" : "Downloading " + count + " titles")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cinemuah:downloads");
            wakeLock.acquire(6 * 60 * 60 * 1000L);
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
