#!/bin/bash
# Web test build, for Claude's tests in a browser (Playwright/Chromium in a
# cloud session); not for Jonas and not part of the Android app.
# Builds into web-build/ (gitignored) and serves it on http://localhost:8765.
# Then drive it with: node scripts/webtest/run.js <steps.js> [--fresh]
set -e
cd "$(dirname "$0")/../.."
OUT=web-build
mkdir -p "$OUT/site"
rm -rf "$OUT/site"/*
npx expo export --platform web --output-dir "$OUT/site" > "$OUT/build.log" 2>&1 || { tail -30 "$OUT/build.log"; exit 1; }
# The engine runs in a Web Worker on the web (src/web/WebViewShim.tsx).
mkdir -p "$OUT/site/engine"
cp assets/engine/stockfish-18-asm.js "$OUT/site/engine/"
if ! curl -s -o /dev/null http://localhost:8765/; then
  (cd "$OUT/site" && nohup python3 -m http.server 8765 > /dev/null 2>&1 &)
  sleep 1
fi
echo "Web test build ready on http://localhost:8765/"
