#!/usr/bin/env bash
#
# App Store screenshots, at the one size Apple actually requires.
#
# App Store Connect wants 6.9" iPhone screenshots — 1320 x 2868 — and scales
# everything smaller from them. That is an iPhone 17 Pro Max (440 x 956 pt at
# 3x); a 17 Pro gives 1206 x 2622 and is rejected on upload. Hence the pinned
# device: it is not a preference, it is the only size that goes in.
#
# Run it with the app already installed and signed in on that simulator, then
# walk the app yourself between prompts. Driving the taps from a script was
# tried and abandoned: tab coordinates move whenever the dock changes, and a
# screenshot set silently taken of the wrong screens is worse than none.
#
#   ./scripts/appstore-screenshots.sh
#
# Output lands in ./screenshots/, which is gitignored.

set -euo pipefail

DEVICE_NAME="iPhone 17 Pro Max"
OUT="${1:-screenshots}"

UDID=$(xcrun simctl list devices available \
  | grep -F "$DEVICE_NAME (" \
  | head -1 \
  | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')

if [ -z "${UDID:-}" ]; then
  echo "No '$DEVICE_NAME' simulator installed." >&2
  echo "Xcode → Settings → Components → iOS Simulator Runtimes, then create one" >&2
  echo "in Devices. Any other model is the wrong pixel size for App Store Connect." >&2
  exit 1
fi

xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || xcrun simctl boot "$UDID"
mkdir -p "$OUT"

# The order App Store Connect shows them in, which is the order that sells:
# what the app asks of you, what it gives back, then the proof it accumulates.
shots=(
  "01-today       Home — the ring, today's topic, the one button"
  "02-booth       Recording — start a take, then run this while the timer is live"
  "03-report      Report — open a scored take, stay at the top (score + verdict)"
  "04-report-detail Report — scroll to 'What matters from this take'"
  "05-progress    Progress — the ink hero and the turn-up grid"
  "06-den         The Den — Felix, the wardrobe, the badges"
)

echo "Capturing at 1320x2868 from $DEVICE_NAME."
echo "Put the app on each screen, then press return."
echo

for entry in "${shots[@]}"; do
  name="${entry%% *}"
  desc="${entry#* }"
  desc="$(echo "$desc" | sed -E 's/^ +//')"
  printf '  %-18s %s\n' "$name" "$desc"
  read -r -p "     ready? [return to shoot, s to skip] " ans
  [ "$ans" = "s" ] && { echo "     skipped"; continue; }
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png" >/dev/null
  size=$(sips -g pixelWidth -g pixelHeight "$OUT/$name.png" \
    | awk '/pixel/ {printf "%s", $2 (NR==1 ? "x" : "")}')
  echo "     saved $OUT/$name.png ($size)"
  if [ "$size" != "1320x2868" ]; then
    echo "     WARNING: expected 1320x2868 — App Store Connect will reject this." >&2
  fi
done

echo
echo "Done. $OUT/ — upload these under 6.9\" iPhone; Apple scales the rest."
