import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parents[2]


def test_every_unity_asset_has_a_meta_file():
    """Sem .meta, cada computador gera um GUID diferente e as cenas perdem referências."""
    result = subprocess.run([sys.executable, str(REPO / "tools" / "new_meta.py"), "--check"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout


def test_gitignore_keeps_assets_and_blocks_secrets():
    ignore = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert "/unity-app/[Ll]ibrary/" in ignore
    for secret in ("*.p12", "*.mobileprovision", "*.key"):
        assert secret in ignore
    assert "*.meta" not in ignore
