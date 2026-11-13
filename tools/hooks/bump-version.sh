#!/bin/sh
# Sobe a versão do app (web/version.json) a cada commit ou merge na main: build 1 = v0.01, 2 = v0.02...
# Instalado como pre-commit e pre-merge-commit por tools/hooks/install.sh.
branch=$(git symbolic-ref --short HEAD 2>/dev/null)
[ "$branch" = "main" ] || exit 0
f="$(git rev-parse --show-toplevel)/web/version.json"
n=$(sed -n 's/.*"build"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$f" 2>/dev/null)
[ -n "$n" ] || n=0
n=$((n + 1))
printf '{ "build": %d }\n' "$n" > "$f"
git add "$f"
echo "Mesa Viva: versão v$(awk "BEGIN { printf \"%.2f\", $n / 100 }")"
