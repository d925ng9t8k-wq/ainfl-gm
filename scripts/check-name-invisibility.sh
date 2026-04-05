#!/bin/bash
# check-name-invisibility.sh
# CI guard: fails if Owner's name appears in any public-facing artifact.
# NON-NEGOTIABLE rule burned Apr 5, 2026.
# Checks: dist/, public/, src/ (visible HTML and JSX content only)
# Excludes: comments in source code, git metadata, node_modules, binary files

set -euo pipefail

FAIL=0
PATTERN="jasson|fishback"

echo "=== Name Invisibility Check ==="

# Check dist/ HTML files (live output — highest priority)
echo "-- Checking dist/ HTML..."
if grep -r -i --include="*.html" "$PATTERN" dist/ 2>/dev/null | grep -v "<!--" | grep -q .; then
  echo "FAIL: Owner name found in dist/ HTML:"
  grep -r -i --include="*.html" "$PATTERN" dist/ 2>/dev/null | grep -v "<!--" | head -20
  FAIL=1
else
  echo "PASS: dist/ HTML is clean."
fi

# Check dist/ JS assets (bundled output)
echo "-- Checking dist/ JS assets..."
if grep -r -i --include="*.js" "$PATTERN" dist/assets/ 2>/dev/null | grep -q .; then
  echo "FAIL: Owner name found in dist/ JS bundle:"
  grep -r -i --include="*.js" "$PATTERN" dist/assets/ 2>/dev/null | head -10
  FAIL=1
else
  echo "PASS: dist/ JS assets are clean."
fi

# Check public/ HTML files (static files that ship to Pages)
echo "-- Checking public/ HTML..."
PUBLIC_HITS=$(grep -r -i --include="*.html" "$PATTERN" public/ 2>/dev/null | grep -v "<!--" || true)
if [ -n "$PUBLIC_HITS" ]; then
  echo "FAIL: Owner name found in public/ HTML:"
  echo "$PUBLIC_HITS" | head -20
  FAIL=1
else
  echo "PASS: public/ HTML is clean."
fi

# Check src/ JSX/JS files — visible rendered strings only (not comments)
echo "-- Checking src/ JSX/JS rendered strings..."
SRC_HITS=$(grep -r -i --include="*.jsx" --include="*.js" --include="*.ts" --include="*.tsx" "$PATTERN" src/ 2>/dev/null | grep -v "^\s*//" | grep -v "^\s*\*" || true)
if [ -n "$SRC_HITS" ]; then
  echo "FAIL: Owner name found in src/ code (rendered strings):"
  echo "$SRC_HITS" | head -20
  FAIL=1
else
  echo "PASS: src/ code is clean."
fi

echo "=== End Name Invisibility Check ==="

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "ERROR: Name invisibility violation detected."
  echo "Owner's name (Jasson Fishback or variants) must NEVER appear in public artifacts."
  echo "See: memory/feedback_name_invisibility_apr5.md"
  exit 1
else
  echo ""
  echo "All checks passed. Owner name not found in any public artifact."
  exit 0
fi
