#!/bin/sh
# Instala o contador de versão nos hooks deste clone (rode uma vez: sh tools/hooks/install.sh).
root=$(git rev-parse --show-toplevel)
hooks=$(git rev-parse --git-path hooks)
for h in pre-commit pre-merge-commit; do
  printf '#!/bin/sh\nexec sh "%s/tools/hooks/bump-version.sh"\n' "$root" > "$hooks/$h"
  chmod +x "$hooks/$h"
done
echo "Hooks instalados em $hooks"
