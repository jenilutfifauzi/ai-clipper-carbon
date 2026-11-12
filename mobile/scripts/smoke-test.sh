#!/usr/bin/env bash
# Installs the APK on the running emulator and checks that the app really opens: the process stays
# alive, nothing crashed, and the home and Local Render screens show their text.
#
#   smoke-test.sh <apk> <account: yes|no>
set -euo pipefail

apk="$1"
account="${2:-no}"
package="id.web.sistems.aiclipcarbon"
out="${RUNNER_TEMP:-/tmp}/smoke"
mkdir -p "$out"

screen_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/ui.xml 2>/dev/null || true
}

# Waits until the screen shows the text, or fails with the evidence saved.
expect_text() {
  local text="$1" name="$2"
  for _ in $(seq 1 30); do
    if screen_text | grep -q "$text"; then
      adb exec-out screencap -p > "$out/$name.png" || true
      echo "ok: \"$text\" is on screen"
      return 0
    fi
    sleep 2
  done
  adb exec-out screencap -p > "$out/$name-failed.png" || true
  screen_text > "$out/$name-failed.xml"
  adb logcat -d > "$out/logcat.txt" || true
  echo "FAILED: \"$text\" never appeared; see the smoke-test artifact" >&2
  return 1
}

adb logcat -c
adb install -r "$apk"
adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1 >/dev/null

expect_text "Buat klip pendek" home
if [ "$account" = "no" ]; then
  expect_text "Login belum dikonfigurasi" home-unconfigured
fi

adb shell am start -W -a android.intent.action.VIEW -d "aiclipcarbon://local-render" "$package" >/dev/null
expect_text "Pilih video dari galeri" local-render

adb logcat -d > "$out/logcat.txt"
if grep -q "FATAL EXCEPTION" "$out/logcat.txt"; then
  echo "FAILED: the app crashed" >&2
  grep -A 25 "FATAL EXCEPTION" "$out/logcat.txt" >&2
  exit 1
fi
if ! adb shell pidof "$package" >/dev/null; then
  echo "FAILED: the app is no longer running" >&2
  exit 1
fi
echo "Smoke test passed."
