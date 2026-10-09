package com.cinemuah.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onDestroy() {
        // Leaving the app for good ends streams and cancels unfinished downloads (same as the desktop app)
        if (isFinishing()) TorrentEngine.get(this).shutdown();
        super.onDestroy();
    }
}
