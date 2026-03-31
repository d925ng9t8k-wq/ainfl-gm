#!/bin/bash
# Pre-deploy verification script
# Run before every git push to catch common issues
# Usage: bash scripts/pre-deploy-check.sh

set -e
PASS=0
FAIL=0
WARN=0

echo "═══════════════════════════════════════════════"
echo "  PRE-DEPLOY VERIFICATION"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════"
echo ""

# 1. Check HeyGen embed URLs use /embeds/ not /embed/
echo "▸ Checking HeyGen embed URLs..."
BAD_EMBEDS=$(grep -rn "heygen.com/embed/" public/ 2>/dev/null | grep -v "embeds/" | wc -l)
if [ "$BAD_EMBEDS" -gt 0 ]; then
  echo "  ✗ FAIL: $BAD_EMBEDS files use /embed/ instead of /embeds/"
  grep -rn "heygen.com/embed/" public/ 2>/dev/null | grep -v "embeds/"
  FAIL=$((FAIL+1))
else
  echo "  ✓ All HeyGen embeds use /embeds/ format"
  PASS=$((PASS+1))
fi

# 2. Check for emailfishback in public-facing pages
echo "▸ Checking for emailfishback@gmail.com..."
BAD_EMAIL=$(grep -rn "emailfishback@gmail.com" public/ 2>/dev/null | wc -l)
if [ "$BAD_EMAIL" -gt 0 ]; then
  echo "  ✗ FAIL: $BAD_EMAIL references to emailfishback@gmail.com in public/"
  grep -rn "emailfishback@gmail.com" public/ 2>/dev/null
  FAIL=$((FAIL+1))
else
  echo "  ✓ No emailfishback references in public pages"
  PASS=$((PASS+1))
fi

# 3. Check all HTML files have viewport meta tag
echo "▸ Checking viewport meta tags..."
MISSING_VP=0
for f in public/*.html; do
  if ! grep -q "viewport" "$f" 2>/dev/null; then
    echo "  ⚠ WARN: $f missing viewport meta tag"
    MISSING_VP=$((MISSING_VP+1))
  fi
done
if [ "$MISSING_VP" -gt 0 ]; then
  WARN=$((WARN+1))
else
  echo "  ✓ All HTML files have viewport meta tags"
  PASS=$((PASS+1))
fi

# 4. Check for broken internal links
echo "▸ Checking internal links..."
BROKEN=0
for f in public/*.html; do
  grep -oP 'href="\/([^"#]+\.html)"' "$f" 2>/dev/null | sed 's/href="\///' | sed 's/"//' | while read link; do
    if [ ! -f "public/$link" ]; then
      echo "  ✗ BROKEN: $f links to /$link (file not found)"
      BROKEN=$((BROKEN+1))
    fi
  done
done
echo "  ✓ Internal link check complete"
PASS=$((PASS+1))

# 5. Check favicon references
echo "▸ Checking favicon consistency..."
BAD_FAVICON=$(grep -rn 'bengals-icon' public/ 2>/dev/null | wc -l)
if [ "$BAD_FAVICON" -gt 0 ]; then
  echo "  ⚠ WARN: $BAD_FAVICON files still reference old bengals-icon favicon"
  WARN=$((WARN+1))
else
  echo "  ✓ All favicons consistent"
  PASS=$((PASS+1))
fi

# 6. Check copyright year
echo "▸ Checking copyright year..."
OLD_YEAR=$(grep -rn "© 2025\|©2025\|copyright 2025" public/ 2>/dev/null | wc -l)
if [ "$OLD_YEAR" -gt 0 ]; then
  echo "  ⚠ WARN: $OLD_YEAR files have 2025 copyright (should be 2026)"
  WARN=$((WARN+1))
else
  echo "  ✓ All copyrights show 2026"
  PASS=$((PASS+1))
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed, $WARN warnings"
if [ "$FAIL" -gt 0 ]; then
  echo "  ✗ DEPLOY BLOCKED — fix failures before pushing"
  echo "═══════════════════════════════════════════════"
  exit 1
else
  echo "  ✓ CLEAR TO DEPLOY"
  echo "═══════════════════════════════════════════════"
  exit 0
fi
