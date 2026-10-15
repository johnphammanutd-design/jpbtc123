#!/usr/bin/env bash
# Build song song 2 bản extension từ cùng mã nguồn extension/:
#   dist/chrome/  + dist/tro-ly-phan-bien-chrome.zip   (manifest thuần Chrome MV3)
#   dist/firefox/ + dist/tro-ly-phan-bien-firefox.zip  (manifest thuần Firefox MV3)
# Chạy: bash scripts/build.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension"
DIST="$ROOT/dist"

rm -rf "$DIST"
mkdir -p "$DIST/chrome" "$DIST/firefox"

cp -r "$SRC"/. "$DIST/chrome/"
cp -r "$SRC"/. "$DIST/firefox/"

# Chrome: bỏ background.scripts và browser_specific_settings (chỉ của Firefox).
python3 - "$DIST/chrome/manifest.json" <<'EOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    m = json.load(f)
m["background"].pop("scripts", None)
m.pop("browser_specific_settings", None)
with open(path, "w") as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF

# Firefox: bỏ background.service_worker (Firefox MV3 dùng event page qua scripts).
python3 - "$DIST/firefox/manifest.json" <<'EOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    m = json.load(f)
m["background"].pop("service_worker", None)
with open(path, "w") as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF

VERSION=$(python3 -c "import json;print(json.load(open('$SRC/manifest.json'))['version'])")

(cd "$DIST/chrome" && zip -qr "$DIST/tro-ly-phan-bien-chrome-v$VERSION.zip" .)
(cd "$DIST/firefox" && zip -qr "$DIST/tro-ly-phan-bien-firefox-v$VERSION.zip" .)

echo "Build xong:"
ls -lh "$DIST"/*.zip
