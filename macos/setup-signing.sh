#!/bin/bash
# One-time setup so GitHub's Mac build signs Townies with your Developer ID and has Apple notarize it.
# Run it in Terminal on your Mac:   bash ~/Townies/macos/setup-signing.sh
#
# What it does, so your passwords never leave your Mac except into GitHub's encrypted secrets:
#  1. finds your "Developer ID Application" certificate in your keychain (and walks you through making one in
#     Xcode if you don't have it yet)
#  2. exports just that certificate and its key, with a random password it makes up, and saves both to the
#     repo's secrets (MACOS_CERT_P12, MACOS_CERT_PASSWORD)
#  3. asks for your Apple ID and an app-specific password, checks them with Apple's notary service, and saves
#     them (NOTARY_APPLE_ID, NOTARY_PASSWORD)
#  4. deletes the exported files and starts the Mac build
# Other repos: pass them as arguments, e.g.  bash setup-signing.sh samuelling/Townies samuelling/chopper
set -euo pipefail
REPOS=("$@"); [ ${#REPOS[@]} -eq 0 ] && REPOS=(samuelling/Townies)
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

[ "$(uname)" = Darwin ] || die "Run this on your Mac."
command -v xcrun > /dev/null || die "Install Xcode (or its command-line tools) first: xcode-select --install"

# GitHub's command-line tool, signed in
if ! command -v gh > /dev/null; then
  command -v brew > /dev/null || die "Install the GitHub CLI first: https://cli.github.com (or install Homebrew, then rerun)."
  say "Installing the GitHub command-line tool…"; brew install gh
fi
gh auth status > /dev/null 2>&1 || { say "Sign in to GitHub (a browser window opens):"; gh auth login --web --git-protocol https; }

# 1. the Developer ID certificate
find_id() { security find-identity -v -p codesigning | grep '"Developer ID Application' | head -1 | sed -E 's/^[^"]*"(.*)"$/\1/'; }
ID=$(find_id || true)
while [ -z "$ID" ]; do
  say "You don't have a Developer ID certificate yet. Make one in Xcode (about a minute):"
  echo "  Xcode › Settings… › Accounts › pick your team › Manage Certificates… › + › Developer ID Application"
  open -a Xcode || true
  read -r -p "Press Return when it's listed there… " _
  ID=$(find_id || true)
done
TEAM=$(echo "$ID" | sed -E 's/.*\(([A-Z0-9]+)\)$/\1/')
say "Using: $ID"

# 2. export just that certificate and key
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PW1=$(openssl rand -hex 16); PW2=$(openssl rand -hex 24)
say "Exporting it. macOS will ask to allow access to your keychain: enter your Mac password and click Allow (or Always Allow) for each key it asks about."
security export -k "$HOME/Library/Keychains/login.keychain-db" -t identities -f pkcs12 -P "$PW1" -o "$TMP/all.p12" > /dev/null
/usr/bin/openssl pkcs12 -in "$TMP/all.p12" -passin "pass:$PW1" -nodes -out "$TMP/all.pem" 2> /dev/null
# keep the Developer ID certificate and the private key with the same localKeyID
awk -v want="Developer ID Application" -v dir="$TMP" '
  /^Bag Attributes/ { attrs = $0 "\n"; inattr = 1; next }
  inattr && /^ / { attrs = attrs $0 "\n"; if ($1 == "localKeyID:") { $1 = ""; kid = $0 } next }
  /^-----BEGIN/ { inattr = 0; block = $0 "\n"; inblock = 1; type = ($0 ~ /CERTIFICATE/) ? "cert" : "key"; next }
  inblock { block = block $0 "\n"; if ($0 ~ /^-----END/) { inblock = 0;
      if (type == "cert") { certs[kid] = certs[kid] block; if (attrs ~ want) devkid = kid } else keys[kid] = block } next }
  END { if (devkid == "") exit 1; printf "%s", certs[devkid] > (dir "/cert.pem"); printf "%s", keys[devkid] > (dir "/key.pem") }
' "$TMP/all.pem" || die "Couldn't pick the Developer ID certificate out of the export."
[ -s "$TMP/key.pem" ] || die "The Developer ID certificate's private key isn't in this keychain. Make the certificate on this Mac (step 1), or import its .p12."
/usr/bin/openssl pkcs12 -export -in "$TMP/cert.pem" -inkey "$TMP/key.pem" -name "$ID" -passout "pass:$PW2" -out "$TMP/devid.p12"
rm -f "$TMP/all.p12" "$TMP/all.pem" "$TMP/key.pem"

# 3. Apple's notary service
say "Notarization needs your Apple ID and an app-specific password (not your real one)."
echo "Opening the page to make one: Sign-In and Security › App-Specific Passwords › + (call it \"notarization\")."
open "https://account.apple.com/account/manage" || true
read -r -p "Apple ID (the one in your developer account): " APPLE_ID
while :; do
  read -r -s -p "App-specific password (xxxx-xxxx-xxxx-xxxx, hidden): " APW; echo
  if xcrun notarytool history --apple-id "$APPLE_ID" --password "$APW" --team-id "$TEAM" > /dev/null 2>&1; then break; fi
  echo "Apple didn't accept that combination. Check the Apple ID and paste the app-specific password again."
done
echo "Apple accepted it."

# save everything as encrypted repository secrets
for R in "${REPOS[@]}"; do
  say "Saving the secrets to $R…"
  base64 -i "$TMP/devid.p12" | gh secret set MACOS_CERT_P12 -R "$R"
  printf '%s' "$PW2" | gh secret set MACOS_CERT_PASSWORD -R "$R"
  printf '%s' "$APPLE_ID" | gh secret set NOTARY_APPLE_ID -R "$R"
  printf '%s' "$APW" | gh secret set NOTARY_PASSWORD -R "$R"
done
unset PW1 PW2 APW

# 4. build it
say "Done. Starting the Mac build for ${REPOS[0]}; Apple's check takes a few minutes."
gh workflow run macos.yml -R "${REPOS[0]}" 2> /dev/null || echo "(Start it from the repo's Actions tab: Mac app › Run workflow.)"
echo "Your exported files have been deleted. Nothing was written outside your keychain except GitHub's encrypted secrets."
