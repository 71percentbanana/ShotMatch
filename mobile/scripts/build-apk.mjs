// One-command Android build: copies shared files, syncs Capacitor, runs Gradle and
// drops the APK at mobile/dist/ShotMatch.apk. Pass --install to push it to a
// USB-connected phone with adb.
//
// Needs JDK 21+ (set SHOTMATCH_JAVA_HOME or JAVA_HOME, or install Android Studio)
// and the Android SDK (ANDROID_HOME, or the default %LOCALAPPDATA%\Android\Sdk).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(mobile, 'android');
const windows = process.platform === 'win32';
const install = process.argv.includes('--install');

function fail(message) { console.error(`\n✖ ${message}\n`); process.exit(1); }
function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: windows, ...options });
  if (result.status !== 0) fail(`${command} failed (exit ${result.status}).`);
}

function javaMajor(home) {
  const java = path.join(home, 'bin', windows ? 'java.exe' : 'java');
  if (!fs.existsSync(java)) return 0;
  const out = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const match = /version "(\d+)/.exec(`${out.stderr}${out.stdout}`);
  return match ? Number(match[1]) : 0;
}

function findJava() {
  const candidates = [
    process.env.SHOTMATCH_JAVA_HOME,
    process.env.JAVA_HOME,
    windows && 'C:\\Program Files\\Android\\Android Studio\\jbr',
    process.platform === 'darwin' && '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    process.platform === 'linux' && '/opt/android-studio/jbr'
  ].filter(Boolean);
  for (const home of candidates) if (javaMajor(home) >= 21) return home;
  fail('JDK 21 or newer was not found. Install Android Studio, or set SHOTMATCH_JAVA_HOME to a JDK 21 folder.');
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    windows ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk')
  ].filter(Boolean);
  const sdk = candidates.find(dir => fs.existsSync(path.join(dir, 'platform-tools')));
  if (!sdk) fail('Android SDK was not found. Install it with Android Studio or set ANDROID_HOME.');
  return sdk;
}

const javaHome = findJava();
const sdk = findSdk();
console.log(`Using JDK:         ${javaHome}`);
console.log(`Using Android SDK: ${sdk}`);
fs.writeFileSync(path.join(android, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`);
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}` };

run('node', ['scripts/copy-shared.mjs'], { cwd: mobile, env });
run('npx', ['cap', 'sync', 'android'], { cwd: mobile, env });
const gradlew = path.join(android, windows ? 'gradlew.bat' : 'gradlew');
run(windows ? `"${gradlew}"` : gradlew, ['assembleDebug', '--console=plain'], { cwd: android, env });

const built = path.join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(built)) fail('Gradle finished but the APK was not found.');
fs.mkdirSync(path.join(mobile, 'dist'), { recursive: true });
const apk = path.join(mobile, 'dist', 'ShotMatch.apk');
fs.copyFileSync(built, apk);
console.log(`\n✔ APK ready: ${apk} (${(fs.statSync(apk).size / 1048576).toFixed(1)} MB)`);

if (install) {
  const adb = path.join(sdk, 'platform-tools', windows ? 'adb.exe' : 'adb');
  run(adb, ['install', '-r', apk], { env });
  run(adb, ['shell', 'monkey', '-p', 'com.chapatisoldiers.shotmatch', '-c', 'android.intent.category.LAUNCHER', '1'], { env });
  console.log('\n✔ Installed and launched on your phone.');
}
