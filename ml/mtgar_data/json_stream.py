"""Leitura incremental de arrays JSON enormes (bulk data do Scryfall).

O arquivo `all_cards` passa de 2 GB; `json.load` nele estoura a memória de
um PC comum. Aqui cada objeto do array é decodificado e devolvido assim que
fica completo no buffer.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import IO, Any

DEFAULT_CHUNK_SIZE = 1 << 20  # 1 MiB
_WHITESPACE = " \t\r\n"


def iter_json_array_stream(stream: IO[str], chunk_size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Any]:
    decoder = json.JSONDecoder()
    buffer = ""
    pos = 0
    eof = False

    def fill() -> bool:
        nonlocal buffer, pos, eof
        chunk = stream.read(chunk_size)
        if not chunk:
            eof = True
            return False
        buffer = buffer[pos:] + chunk
        pos = 0
        return True

    def skip(chars: str) -> None:
        nonlocal pos
        while True:
            while pos < len(buffer) and buffer[pos] in chars:
                pos += 1
            if pos < len(buffer) or not fill():
                return

    skip(_WHITESPACE)
    if pos >= len(buffer) or buffer[pos] != "[":
        raise ValueError("o arquivo não começa com um array JSON '['")
    pos += 1

    while True:
        skip(_WHITESPACE + ",")
        if pos >= len(buffer):
            raise ValueError("array JSON terminou sem ']'")
        if buffer[pos] == "]":
            return
        while True:
            try:
                obj, end = decoder.raw_decode(buffer, pos)
            except json.JSONDecodeError:
                # Objeto cortado no fim do bloco: lê mais e tenta de novo.
                if eof or not fill():
                    raise
                continue
            if end == len(buffer) and not eof:
                # Um número no fim do buffer pode estar incompleto ("12" de "123").
                if fill():
                    continue
            pos = end
            yield obj
            break


def iter_json_array(path: str | Path, chunk_size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Any]:
    with open(path, encoding="utf-8-sig") as stream:  # tolera BOM
        yield from iter_json_array_stream(stream, chunk_size)
