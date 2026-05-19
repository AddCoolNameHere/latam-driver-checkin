#!/bin/bash
# Valida sintaxe de todos os arquivos JS/HTML antes de commitar.
# Uso: ./validate.sh

set -e
cd "$(dirname "$0")"

echo "=== Validando sintaxe JS ==="

PY="${PYTHON:-python}"
command -v "$PY" >/dev/null 2>&1 || PY=python3

# Diretório temporário próprio do script — funciona tanto no Git Bash (Windows)
# quanto em Linux/WSL, sem confusão entre /tmp do bash e C:\tmp do Python nativo.
TMP_DIR="./.validate-tmp"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

check_html() {
  local f="$1"
  local out="$TMP_DIR/check.js"
  rm -f "$out"
  "$PY" -c "
import re, sys
with open(r'$f', encoding='utf-8') as fp: c = fp.read()
m = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', c, re.DOTALL)
if not m:
  print('(sem JS inline) ' + r'$f')
  sys.exit(0)
open(r'$out','w',encoding='utf-8').write('\n//---SPLIT---\n'.join(m))
"
  if [ -f "$out" ]; then
    node --check "$out" && echo "✓ $f" || { echo "✗ $f"; return 1; }
  fi
}

check_gas() {
  local f="$1"
  local out="$TMP_DIR/check_gas.js"
  cp "$f" "$out"
  node --check "$out" && echo "✓ $f" || { echo "✗ $f"; return 1; }
}

# Frontend
node --check auth.js && echo "✓ auth.js"
node --check theme.js && echo "✓ theme.js"
node --check common.js && echo "✓ common.js"
check_html auth-helper.html
check_html index.html
check_html dashboard.html
check_html driver-profile.html
check_html ramp.html
check_html assets.html
check_html cash.html
check_html pmo.html
check_html country_scopes.html
check_html ar-divergencias.html
check_html ar-divergencias-admin.html
check_html admin.html
check_html admin-users.html
check_html recruitment.html

# Backend
check_gas "apps-script/Code udpt.gs"

echo ""
echo "=== Validando configs preservadas ==="
grep -q "spreadsheetId.*1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg" "apps-script/Code udpt.gs" && echo "✓ spreadsheetId" || { echo "✗ spreadsheetId mudou!"; exit 1; }
grep -q "lucas.fuss@aceolution.com" "apps-script/Code udpt.gs" && echo "✓ emails" || { echo "✗ emails removidos!"; exit 1; }
grep -q "username: 'fuss'" auth.js && echo "✓ users" || { echo "✗ user fuss removido!"; exit 1; }

echo ""
echo "✅ Tudo válido. Pode commitar."
