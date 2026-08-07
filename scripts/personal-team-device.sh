#!/usr/bin/env bash
#
# Run Elovox on YOUR OWN iPhone with a free (personal) Apple team.
#
# A personal team cannot sign two of this app's capabilities:
#
#   Sign in with Apple   paid programme only
#   App Groups           paid programme only
#
# so a device build fails before it starts. This strips both, leaving an app
# that is identical in every other respect, so the thing can be held in a hand
# before anyone pays $99.
#
# WHAT YOU LOSE WHILE IT IS STRIPPED
#   - The "Continue with Apple" button stops working. Email/password and
#     Google still do.
#   - The Home Screen widget shows its placeholder instead of your streak and
#     today's topic — that data crosses processes through the App Group.
#   - The Dynamic Island, the Siri shortcut and the share sheet are unaffected.
#     None of them needs a paid capability.
#
# THIS MUST NEVER REACH THE APP STORE. An app that offers Google sign-in and
# not Sign in with Apple is a Guideline 4.8 rejection. The script refuses to
# run on a dirty tree for exactly that reason: `git checkout` is then always a
# complete and obvious undo, and it prints the command before it does anything.
#
#   ./scripts/personal-team-device.sh          strip
#   git checkout ios/                          restore
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain ios/)" ]; then
  echo "ios/ has uncommitted changes." >&2
  echo "Commit or stash them first — this script's undo is 'git checkout ios/'," >&2
  echo "and that would take your work with it." >&2
  exit 1
fi

APP_ENT="ios/App/App/App.entitlements"
WIDGET_ENT="ios/App/ElovoxWidgets/ElovoxWidgets.entitlements"
P=/usr/libexec/PlistBuddy

echo "Stripping paid-only capabilities…"

$P -c "Delete :com.apple.developer.applesignin" "$APP_ENT" 2>/dev/null \
  && echo "  - Sign in with Apple (app)" || true
$P -c "Delete :com.apple.security.application-groups" "$APP_ENT" 2>/dev/null \
  && echo "  - App Group (app)" || true
$P -c "Delete :com.apple.security.application-groups" "$WIDGET_ENT" 2>/dev/null \
  && echo "  - App Group (widget)" || true

plutil -lint "$APP_ENT" "$WIDGET_ENT"

cat <<'EOF'

Done. Now, in Xcode:

  1. open ios/App/App.xcodeproj
  2. plug the iPhone in and pick it as the run destination
  3. Signing & Capabilities → your personal team, on BOTH targets
     (App and ElovoxWidgets)
  4. Run. First launch needs Settings → General → VPN & Device Management
     → trust the developer certificate.

Free-team profiles expire after 7 days; rebuild from Xcode to renew.

WHEN YOU ARE DONE, PUT IT BACK:

  git checkout ios/

Leaving it stripped and committing it ships an app that Apple rejects
under Guideline 4.8.
EOF
