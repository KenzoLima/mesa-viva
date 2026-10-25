#!/usr/bin/env python3
"""Cria os arquivos .meta que faltam em unity-app/Assets (e checa os órfãos).

Por que: o Unity identifica cada asset pelo GUID do .meta. Se um arquivo entra no
repositório sem .meta, cada computador gera um GUID diferente e cenas/prefabs
perdem as referências. Regra do projeto: todo asset é commitado junto do seu .meta.

Uso:
    python tools/new_meta.py            # cria os .meta que faltam
    python tools/new_meta.py --check    # só verifica (sai com 1 se houver problema)
"""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / "unity-app" / "Assets"

FOLDER_META = """fileFormatVersion: 2
guid: {guid}
folderAsset: yes
DefaultImporter:
  externalObjects: {{}}
  userData:
  assetBundleName:
  assetBundleVariant:
"""

# Mínimo que o Unity aceita: ele completa as configurações do importador na primeira
# importação e mantém o GUID.
FILE_META = """fileFormatVersion: 2
guid: {guid}
"""

IGNORED_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def _ignored(path: Path) -> bool:
    # O Unity ignora arquivos/pastas ocultos e terminados em "~".
    return (
        path.name in IGNORED_NAMES
        or path.name.startswith(".")
        or path.name.endswith("~")
        or path.suffix == ".meta"
    )


def scan(assets: Path) -> tuple[list[Path], list[Path]]:
    missing, orphans = [], []
    for path in sorted(assets.rglob("*")):
        if any(_ignored(part) for part in path.relative_to(assets).parents if part != Path(".")):
            continue
        if path.suffix == ".meta":
            target = path.with_suffix("")
            if not target.exists():
                orphans.append(path)
            continue
        if _ignored(path):
            continue
        if not Path(str(path) + ".meta").exists():
            missing.append(path)
    return missing, orphans


def write_meta(path: Path) -> Path:
    meta = Path(str(path) + ".meta")
    template = FOLDER_META if path.is_dir() else FILE_META
    meta.write_text(template.format(guid=uuid.uuid4().hex), encoding="utf-8", newline="\n")
    return meta


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="só verifica, sem criar nada")
    parser.add_argument("--assets", type=Path, default=ASSETS)
    args = parser.parse_args(argv)

    missing, orphans = scan(args.assets)
    for orphan in orphans:
        print(f"órfão (asset não existe): {orphan.relative_to(args.assets)}")
    if args.check:
        for path in missing:
            print(f"sem .meta: {path.relative_to(args.assets)}")
        ok = not missing and not orphans
        print("ok: todos os assets têm .meta" if ok else f"{len(missing)} sem .meta, {len(orphans)} órfãos")
        return 0 if ok else 1

    for path in missing:
        write_meta(path)
        print(f"criado: {path.relative_to(args.assets)}.meta")
    print(f"{len(missing)} .meta criados")
    return 1 if orphans else 0


if __name__ == "__main__":
    sys.exit(main())
