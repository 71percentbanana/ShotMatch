# ShotMatch Android prototype

A Capacitor wrapper around a phone-first version of the ShotMatch web demo. It builds a **debug APK** you can sideload onto an Android phone. Android only; there is no iOS build.

Like the web demo, **no trained AI runs here**. Framing feedback is simulated from pan/zoom relative to preset framing (see the root [README](../README.md) for the concept boundaries).

## Layout

- `www/`: the phone UI (`index.html`, `mobile.css`, `js/app.js`). Edit this.
- `www/assets/`, `www/vendor/`: copied from the repo root by `npm run copy`. Do not edit; change the root copies.
- `android/`: generated Capacitor Android project (Gradle).
- `scripts/copy-shared.mjs`: copies shared assets into `www/`.
- `scripts/build-apk.mjs`: copy, `cap sync`, Gradle build, then writes `dist/ShotMatch.apk`.
- `capacitor.config.json`: app id `com.chapatisoldiers.shotmatch`, name `ShotMatch`.

## Prerequisites

1. **Node.js 18+**.
2. **JDK 21 or newer.** JDK 17 will not work (Capacitor 8 targets Java 21). Either install Android Studio (its bundled JDK is detected automatically) or download a portable Temurin 21 and point `SHOTMATCH_JAVA_HOME` at it.
3. **Android SDK** with platform 36 and build-tools, via Android Studio or the command-line tools. Detected at `ANDROID_HOME` or `%LOCALAPPDATA%\Android\Sdk`.

## Build the APK

From this `mobile/` folder:

```sh
npm install
npm run apk
```

PowerShell, using a portable JDK in `C:\Users\<you>\jdk21`:

```powershell
$env:SHOTMATCH_JAVA_HOME="$env:USERPROFILE\jdk21"
npm install
npm run apk
```

The first build downloads Gradle and dependencies and takes about 5 minutes. Output: `mobile/dist/ShotMatch.apk` (about 4.4 MB). `dist/` is git-ignored, so rebuild it after cloning.

## Install on your phone

### Option A: copy the file

1. Move `ShotMatch.apk` to the phone (Drive, USB cable, messaging yourself).
2. Open it on the phone and allow "Install unknown apps" for that app when prompted.
3. Open ShotMatch and allow camera access when you choose Camera mode.

### Option B: USB with adb

1. On the phone, enable Developer options, then USB debugging.
2. Plug it in and accept the debugging prompt.
3. Run:

   ```sh
   npm run install-phone
   ```

   This rebuilds, installs with `adb install -r`, and launches the app.

Check the phone is seen with `adb devices` (in `<Android SDK>/platform-tools`).

## Changing the app

1. Edit files in `www/` (or the shared `assets/` and `vendor/` in the repo root).
2. Run `npm run apk` again and reinstall.

`npm run sync` only copies the shared files and runs `cap sync android` without building. The WebView is debuggable, so you can inspect it from Chrome at `chrome://inspect` with the phone plugged in.

## Troubleshooting

- **"JDK 21 or newer was not found":** set `SHOTMATCH_JAVA_HOME` to a JDK 21 folder.
- **"Android SDK was not found":** install it or set `ANDROID_HOME`.
- **Install blocked on the phone:** allow installs from the app you opened the APK with, or use Option B.
- **Camera does not start:** check Settings, Apps, ShotMatch, Permissions, Camera.

## Limits

Debug-signed prototype, not for the Play Store. A release build needs your own signing key and `assembleRelease`.
