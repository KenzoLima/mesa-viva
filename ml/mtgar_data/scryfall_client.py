"""Cliente mínimo da API do Scryfall (só biblioteca padrão).

Segue as regras de uso do Scryfall (https://scryfall.com/docs/api):
- envia User-Agent e Accept em toda requisição;
- espera pelo menos 100 ms entre requisições;
- usa o bulk data em vez de milhares de chamadas individuais.
"""

from __future__ import annotations

import gzip
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .text_norm import normalize_name

API_BASE = "https://api.scryfall.com"
DEFAULT_USER_AGENT = "mtg-ar/0.1 (projeto pessoal de realidade aumentada)"
JSON_ACCEPT = "application/json;q=0.9,*/*;q=0.8"
DOWNLOAD_CHUNK = 1 << 20
RETRY_STATUS = {429, 500, 502, 503, 504}

Opener = Callable[[urllib.request.Request, float], Any]
Progress = Callable[[int, int | None], None]


class ScryfallError(RuntimeError):
    pass


def _default_opener(request: urllib.request.Request, timeout: float) -> Any:
    return urllib.request.urlopen(request, timeout=timeout)


class ScryfallClient:
    def __init__(
        self,
        user_agent: str = DEFAULT_USER_AGENT,
        opener: Opener | None = None,
        min_interval: float = 0.1,
        max_retries: int = 4,
        timeout: float = 60.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.user_agent = user_agent
        self.opener = opener or _default_opener
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.timeout = timeout
        self.sleep = sleep
        self.clock = clock
        self._last_request: float | None = None

    # ---------- HTTP ----------

    def _wait_rate_limit(self) -> None:
        if self._last_request is not None:
            elapsed = self.clock() - self._last_request
            if elapsed < self.min_interval:
                self.sleep(self.min_interval - elapsed)
        self._last_request = self.clock()

    def open(self, url: str, accept: str = JSON_ACCEPT) -> Any:
        """Abre a URL com rate limit e retry (backoff 2, 4, 8, 16 s)."""
        if url.startswith("/"):
            url = API_BASE + url
        request = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": accept})
        attempt = 0
        while True:
            self._wait_rate_limit()
            try:
                return self.opener(request, self.timeout)
            except urllib.error.HTTPError as err:
                if err.code not in RETRY_STATUS or attempt >= self.max_retries:
                    raise ScryfallError(self._describe_http_error(url, err)) from err
                delay = self._retry_after(err) or 2 ** (attempt + 1)
            except (urllib.error.URLError, ConnectionError, TimeoutError) as err:
                if attempt >= self.max_retries:
                    raise ScryfallError(f"não foi possível acessar {url}: {err}") from err
                delay = 2 ** (attempt + 1)
            attempt += 1
            self.sleep(delay)

    @staticmethod
    def _retry_after(err: urllib.error.HTTPError) -> float | None:
        value = err.headers.get("Retry-After") if err.headers else None
        try:
            return float(value) if value else None
        except ValueError:
            return None

    @staticmethod
    def _describe_http_error(url: str, err: urllib.error.HTTPError) -> str:
        detail = ""
        try:
            body = json.loads(err.read().decode("utf-8"))
            detail = body.get("details", "")
        except Exception:
            pass
        return f"Scryfall respondeu {err.code} para {url}" + (f": {detail}" if detail else "")

    def get_json(self, url: str) -> Any:
        with self.open(url) as response:
            return json.loads(_read_body(response).decode("utf-8"))

    # ---------- bulk data ----------

    def list_bulk_data(self) -> list[dict[str, Any]]:
        return self.get_json("/bulk-data")["data"]

    def find_bulk(self, bulk_type: str) -> dict[str, Any]:
        for item in self.list_bulk_data():
            if item.get("type") == bulk_type:
                return item
        raise ScryfallError(f"tipo de bulk data desconhecido: {bulk_type}")

    def download_bulk(
        self, bulk_type: str, out_dir: str | Path, force: bool = False, progress: Progress | None = None
    ) -> tuple[Path, bool]:
        """Baixa um arquivo de bulk data. Retorna (caminho, baixou_agora).

        Se o arquivo local já corresponde ao `updated_at` atual do Scryfall, não baixa de novo.
        """
        info = self.find_bulk(bulk_type)
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / f"{bulk_type}.json"
        meta_path = out_dir / f"{bulk_type}.meta.json"
        if not force and dest.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("updated_at") == info.get("updated_at"):
                return dest, False

        self.download_file(info["download_uri"], dest, accept="application/json", progress=progress,
                           expected_size=info.get("size"))
        meta_path.write_text(json.dumps({
            "type": bulk_type,
            "updated_at": info.get("updated_at"),
            "size": info.get("size"),
            "download_uri": info["download_uri"],
        }, indent=2), encoding="utf-8")
        return dest, True

    def download_file(
        self,
        url: str,
        dest: str | Path,
        accept: str = "*/*",
        progress: Progress | None = None,
        expected_size: int | None = None,
    ) -> Path:
        """Baixa em streaming para `dest.part` e só renomeia no fim (nunca deixa arquivo pela metade)."""
        dest = Path(dest)
        part = dest.with_name(dest.name + ".part")
        with self.open(url, accept=accept) as response:
            stream = response
            if (response.headers.get("Content-Encoding") or "").lower() == "gzip":
                stream = gzip.GzipFile(fileobj=response)
            total = expected_size or _content_length(response)
            done = 0
            with open(part, "wb") as out:
                while True:
                    chunk = stream.read(DOWNLOAD_CHUNK)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, total)
        os.replace(part, dest)
        return dest

    # ---------- cartas individuais ----------

    def card_named(self, name: str, exact: bool = True) -> dict[str, Any]:
        query = urllib.parse.urlencode({"exact" if exact else "fuzzy": name})
        return self.get_json(f"/cards/named?{query}")

    def download_card_image(self, name: str, dest_dir: str | Path, version: str = "large") -> list[Path]:
        """Baixa a imagem da carta (todas as faces, se for de duas faces)."""
        card = self.card_named(name, exact=False)
        faces = [card] if card.get("image_uris") else card.get("card_faces", [])
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for index, face in enumerate(faces):
            uri = (face.get("image_uris") or {}).get(version)
            if not uri:
                continue
            suffix = ".png" if version == "png" else ".jpg"
            label = slugify(face.get("name") or card["name"])
            if len(faces) > 1:
                label += f"_face{index}"
            paths.append(self.download_file(uri, dest_dir / f"{label}{suffix}", accept="image/*"))
        if not paths:
            raise ScryfallError(f"a carta '{card.get('name', name)}' não tem imagem na versão '{version}'")
        return paths


def _read_body(response: Any) -> bytes:
    body = response.read()
    if (response.headers.get("Content-Encoding") or "").lower() == "gzip":
        body = gzip.decompress(body)
    return body


def _content_length(response: Any) -> int | None:
    value = response.headers.get("Content-Length")
    return int(value) if value and value.isdigit() else None


def slugify(name: str) -> str:
    slug = "".join(c if c.isalnum() else "_" for c in normalize_name(name))
    return "_".join(part for part in slug.split("_") if part)
