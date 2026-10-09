# Cinemuah for Android

The phone app reuses the same React UI as the desktop app (`../src`). `shim/` replaces the Electron backend with an
Android one, and `android/` is the native wrapper (Capacitor) with a libtorrent streaming engine.

## Build the APK
```powershell
npm install        # first time only
npm run apk        # bundles the UI, syncs it, builds and signs Cinemuah.apk in this folder
```
Needs the toolchain in `%USERPROFILE%\android-tools` (JDK 17 + Android SDK 34) - see `build-apk.ps1`.

## Layout
| Path | What it is |
|---|---|
| `shim/electron-shim.ts` | Android `window.electronAPI` (same shape the desktop UI expects) |
| `shim/yts.ts`, `shim/series.ts` | YTS + TVMaze/EZTV clients (ports of the desktop services) |
| `shim/library.ts` | Offline library = files downloaded to `Movies/Cinemuah` |
| `shim/mobile.css` | Phone layout (bottom tab bar, compact top bar, touch tweaks) |
| `android/app/src/main/java/com/cinemuah/app/` | Native side: `TorrentEngine`, `StreamServer`, `Net` (DNS-over-HTTPS), `Library`, `DownloadService`, `NativePlugin` |

## Signing
`cinemuah-release.jks` + `keystore.properties` sign the release APK. Keep both: updates must be signed with the same key
to install over an existing copy.

## Known limits
- No transcoding on Android: playback depends on the phone's codecs (H.264/AAC is safe; HEVC works on most modern phones;
  AC3/DTS audio plays silent).
- Downloads are kept while the app is open or its notification is showing; closing the app cancels unfinished downloads.
