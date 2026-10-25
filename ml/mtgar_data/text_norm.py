"""Normalização de nomes de cartas para busca tolerante.

"Æther Vial", "Aether Vial" e "aether  vial" devem achar a mesma carta;
o mesmo vale para apóstrofos tipográficos e acentos dos nomes em português.
"""

from __future__ import annotations

import re
import unicodedata

_LIGATURES = {"æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe", "ß": "ss"}
_APOSTROPHES = {"‘": "'", "’": "'", "ʼ": "'", "`": "'", "´": "'"}
_DASHES = {"–": "-", "—": "-", "−": "-"}
_SPACES = re.compile(r"\s+")
_FACE_SEP = re.compile(r"\s*/{1,2}\s*")


def normalize_name(name: str) -> str:
    """Chave de busca: minúsculas, sem acentos, apóstrofos/traços padronizados."""
    if not name:
        return ""
    for table in (_LIGATURES, _APOSTROPHES, _DASHES):
        for src, dst in table.items():
            name = name.replace(src, dst)
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    stripped = _FACE_SEP.sub(" // ", stripped)  # "Fire/Ice", "Fire / Ice" -> "Fire // Ice"
    return _SPACES.sub(" ", stripped).strip().casefold()
