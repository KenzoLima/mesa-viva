"""Banco local de cartas (SQLite) montado a partir do bulk data do Scryfall.

O app usa este banco para:
- resolver listas de deck (nome em inglês, nome de face ou nome em português -> oracle_id);
- saber tipo, subtipos, cores, P/T e keywords de cada carta (escolha do modelo 3D);
- listar as artes (`artworks`) que entram no índice de reconhecimento visual (Fase 2).
"""

from __future__ import annotations

import difflib
import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .text_norm import normalize_name
from .type_line import parse_type_line, split_faces

SCHEMA_VERSION = 1

# Layouts que não representam uma carta de jogo física.
SKIPPED_LAYOUTS = {"art_series"}
TOKEN_LAYOUTS = {"token", "double_faced_token", "emblem"}

_SCHEMA = """
CREATE TABLE cards (
    oracle_id      TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    layout         TEXT NOT NULL,
    is_token       INTEGER NOT NULL,
    type_line      TEXT NOT NULL,
    supertypes     TEXT NOT NULL,
    card_types     TEXT NOT NULL,
    subtypes       TEXT NOT NULL,
    colors         TEXT NOT NULL,
    color_identity TEXT NOT NULL,
    mana_cost      TEXT,
    cmc            REAL,
    power          TEXT,
    toughness      TEXT,
    keywords       TEXT NOT NULL,
    produced_mana  TEXT NOT NULL,
    oracle_text    TEXT
);
CREATE TABLE faces (
    oracle_id  TEXT NOT NULL REFERENCES cards(oracle_id),
    face_index INTEGER NOT NULL,
    name       TEXT NOT NULL,
    type_line  TEXT,
    card_types TEXT NOT NULL,
    subtypes   TEXT NOT NULL,
    colors     TEXT NOT NULL,
    mana_cost  TEXT,
    power      TEXT,
    toughness  TEXT,
    PRIMARY KEY (oracle_id, face_index)
);
CREATE TABLE names (
    norm_name    TEXT NOT NULL,
    oracle_id    TEXT NOT NULL REFERENCES cards(oracle_id),
    lang         TEXT NOT NULL,
    display_name TEXT NOT NULL,
    PRIMARY KEY (norm_name, oracle_id, lang)
);
CREATE TABLE artworks (
    scryfall_id      TEXT NOT NULL,
    face_index       INTEGER NOT NULL,
    illustration_id  TEXT,
    oracle_id        TEXT NOT NULL REFERENCES cards(oracle_id),
    set_code         TEXT,
    collector_number TEXT,
    lang             TEXT,
    image_normal     TEXT,
    image_art_crop   TEXT,
    PRIMARY KEY (scryfall_id, face_index)
);
CREATE INDEX artworks_oracle ON artworks(oracle_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


@dataclass
class CardFace:
    face_index: int
    name: str
    type_line: str | None
    card_types: list[str]
    subtypes: list[str]
    colors: list[str]
    mana_cost: str | None
    power: str | None
    toughness: str | None


@dataclass
class CardRecord:
    oracle_id: str
    name: str
    layout: str
    is_token: bool
    type_line: str
    supertypes: list[str]
    card_types: list[str]  # tipos da face frontal
    subtypes: list[str]    # subtipos da face frontal
    colors: list[str]
    color_identity: list[str]
    mana_cost: str | None
    cmc: float | None
    power: str | None
    toughness: str | None
    keywords: list[str]
    produced_mana: list[str]
    oracle_text: str | None
    faces: list[CardFace] = field(default_factory=list)

    def has_type(self, card_type: str) -> bool:
        return card_type in self.card_types


def _oracle_id(card: dict[str, Any]) -> str | None:
    if card.get("oracle_id"):
        return card["oracle_id"]
    # Layout "reversible_card": o oracle_id fica só dentro das faces.
    for face in card.get("card_faces") or []:
        if face.get("oracle_id"):
            return face["oracle_id"]
    return None


def _is_playable_object(card: dict[str, Any]) -> bool:
    return (
        card.get("object") == "card"
        and card.get("layout") not in SKIPPED_LAYOUTS
        and not card.get("digital", False)  # cartas só do Arena/MTGO (ex.: "A-...") nunca estão na mesa
    )


def card_from_scryfall(card: dict[str, Any]) -> CardRecord | None:
    """Converte um objeto do Scryfall em CardRecord; None se não for carta de mesa."""
    if not _is_playable_object(card):
        return None
    oracle_id = _oracle_id(card)
    if not oracle_id:
        return None

    raw_faces = card.get("card_faces") or []
    front = raw_faces[0] if raw_faces else card
    type_line = card.get("type_line") or " // ".join(f.get("type_line", "") for f in raw_faces)
    front_type = parse_type_line(front.get("type_line") or split_faces(type_line)[0] if type_line else None)

    colors = card.get("colors")
    if colors is None:
        colors = sorted({c for f in raw_faces for c in f.get("colors", [])})

    faces = []
    for index, face in enumerate(raw_faces):
        face_type = parse_type_line(face.get("type_line"))
        faces.append(CardFace(
            face_index=index,
            name=face.get("name", ""),
            type_line=face.get("type_line"),
            card_types=face_type.card_types,
            subtypes=face_type.subtypes,
            colors=face.get("colors", colors),
            mana_cost=face.get("mana_cost"),
            power=face.get("power"),
            toughness=face.get("toughness"),
        ))

    oracle_text = card.get("oracle_text")
    if oracle_text is None and raw_faces:
        oracle_text = "\n//\n".join(f.get("oracle_text", "") for f in raw_faces)

    layout = card.get("layout", "normal")
    return CardRecord(
        oracle_id=oracle_id,
        name=card["name"],
        layout=layout,
        is_token=layout in TOKEN_LAYOUTS,
        type_line=type_line,
        supertypes=front_type.supertypes,
        card_types=front_type.card_types,
        subtypes=front_type.subtypes,
        colors=list(colors),
        color_identity=list(card.get("color_identity", [])),
        mana_cost=card.get("mana_cost", front.get("mana_cost")),
        cmc=card.get("cmc"),
        power=card.get("power", front.get("power")),
        toughness=card.get("toughness", front.get("toughness")),
        keywords=list(card.get("keywords", [])),
        produced_mana=list(card.get("produced_mana", [])),
        oracle_text=oracle_text,
        faces=faces,
    )


class CardDatabase:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self._known_oracle_ids: set[str] | None = None
        self._all_names: list[str] | None = None

    # ---------- criação ----------

    @classmethod
    def create(cls, path: str | Path) -> "CardDatabase":
        """Cria um banco novo, apagando o arquivo existente."""
        path = Path(path)
        if path.exists():
            path.unlink()
        db = cls(path)
        db.conn.executescript(_SCHEMA)
        db.set_meta("schema_version", str(SCHEMA_VERSION))
        db._known_oracle_ids = set()
        return db

    def _known(self) -> set[str]:
        if self._known_oracle_ids is None:
            self._known_oracle_ids = {r[0] for r in self.conn.execute("SELECT oracle_id FROM cards")}
        return self._known_oracle_ids

    def set_meta(self, key: str, value: str) -> None:
        self.conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value))

    def get_meta(self, key: str) -> str | None:
        row = self.conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def add_card(self, card: dict[str, Any]) -> bool:
        """Adiciona uma carta do bulk `oracle_cards`/`default_cards`. Retorna False se ignorada."""
        record = card_from_scryfall(card)
        if record is None or record.oracle_id in self._known():
            return False
        self.conn.execute(
            "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                record.oracle_id, record.name, record.layout, int(record.is_token), record.type_line,
                json.dumps(record.supertypes), json.dumps(record.card_types), json.dumps(record.subtypes),
                json.dumps(record.colors), json.dumps(record.color_identity), record.mana_cost, record.cmc,
                record.power, record.toughness, json.dumps(record.keywords),
                json.dumps(record.produced_mana), record.oracle_text,
            ),
        )
        for face in record.faces:
            self.conn.execute(
                "INSERT INTO faces VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    record.oracle_id, face.face_index, face.name, face.type_line,
                    json.dumps(face.card_types), json.dumps(face.subtypes), json.dumps(face.colors),
                    face.mana_cost, face.power, face.toughness,
                ),
            )
        self._add_name(record.name, record.oracle_id, "en")
        for face in record.faces:
            self._add_name(face.name, record.oracle_id, "en")
        self._known().add(record.oracle_id)
        self._all_names = None
        return True

    def add_printed_names(self, card: dict[str, Any]) -> int:
        """Registra o nome impresso de uma impressão não inglesa (bulk `all_cards`)."""
        if card.get("lang", "en") == "en" or not _is_playable_object(card):
            return 0
        oracle_id = _oracle_id(card)
        if oracle_id not in self._known():
            return 0
        lang = card["lang"]
        names = [card.get("printed_name")]
        names += [face.get("printed_name") for face in card.get("card_faces") or []]
        added = sum(self._add_name(name, oracle_id, lang) for name in names if name)
        if added:
            self._all_names = None
        return added

    def add_artwork(self, card: dict[str, Any]) -> int:
        """Registra as artes de uma impressão (bulk `unique_artwork`)."""
        if not _is_playable_object(card):
            return 0
        oracle_id = _oracle_id(card)
        if oracle_id not in self._known():
            return 0
        sources = card.get("card_faces") if not card.get("image_uris") else None
        sources = sources or [card]
        added = 0
        for index, face in enumerate(sources):
            uris = face.get("image_uris") or {}
            if not uris.get("normal"):
                continue
            self.conn.execute(
                "INSERT OR IGNORE INTO artworks VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    card["id"], index, face.get("illustration_id") or card.get("illustration_id"),
                    oracle_id, card.get("set"), card.get("collector_number"), card.get("lang"),
                    uris.get("normal"), uris.get("art_crop"),
                ),
            )
            added += 1
        return added

    def _add_name(self, display_name: str, oracle_id: str, lang: str) -> bool:
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO names VALUES (?,?,?,?)",
            (normalize_name(display_name), oracle_id, lang, display_name),
        )
        return cur.rowcount > 0

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        self.conn.commit()
        self.conn.close()

    def __enter__(self) -> "CardDatabase":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ---------- consultas ----------

    def count(self, table: str) -> int:
        if table not in {"cards", "faces", "names", "artworks"}:
            raise ValueError(table)
        return self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def get(self, oracle_id: str) -> CardRecord | None:
        row = self.conn.execute("SELECT * FROM cards WHERE oracle_id = ?", (oracle_id,)).fetchone()
        if row is None:
            return None
        faces = [
            CardFace(
                face_index=f["face_index"], name=f["name"], type_line=f["type_line"],
                card_types=json.loads(f["card_types"]), subtypes=json.loads(f["subtypes"]),
                colors=json.loads(f["colors"]), mana_cost=f["mana_cost"],
                power=f["power"], toughness=f["toughness"],
            )
            for f in self.conn.execute(
                "SELECT * FROM faces WHERE oracle_id = ? ORDER BY face_index", (oracle_id,)
            )
        ]
        return CardRecord(
            oracle_id=row["oracle_id"], name=row["name"], layout=row["layout"],
            is_token=bool(row["is_token"]), type_line=row["type_line"],
            supertypes=json.loads(row["supertypes"]), card_types=json.loads(row["card_types"]),
            subtypes=json.loads(row["subtypes"]), colors=json.loads(row["colors"]),
            color_identity=json.loads(row["color_identity"]), mana_cost=row["mana_cost"],
            cmc=row["cmc"], power=row["power"], toughness=row["toughness"],
            keywords=json.loads(row["keywords"]), produced_mana=json.loads(row["produced_mana"]),
            oracle_text=row["oracle_text"], faces=faces,
        )

    def lookup(self, name: str) -> list[CardRecord]:
        """Cartas cujo nome (inglês, face ou traduzido) bate com `name`.

        Cartas de jogo vêm antes de tokens; dentro disso, nome inglês antes de traduções.
        """
        rows = self.conn.execute(
            """
            SELECT n.oracle_id, MIN(CASE WHEN n.lang = 'en' THEN 0 ELSE 1 END) AS lang_rank, c.is_token
            FROM names n JOIN cards c ON c.oracle_id = n.oracle_id
            WHERE n.norm_name = ?
            GROUP BY n.oracle_id
            ORDER BY c.is_token, lang_rank, c.name
            """,
            (normalize_name(name),),
        ).fetchall()
        return [card for card in (self.get(r["oracle_id"]) for r in rows) if card]

    def suggest(self, name: str, limit: int = 3) -> list[str]:
        """Nomes parecidos para corrigir erros de digitação."""
        if self._all_names is None:
            self._all_names = [r[0] for r in self.conn.execute("SELECT DISTINCT norm_name FROM names")]
        matches = difflib.get_close_matches(normalize_name(name), self._all_names, n=limit, cutoff=0.75)
        result = []
        for norm in matches:
            row = self.conn.execute(
                "SELECT display_name FROM names WHERE norm_name = ? ORDER BY lang != 'en' LIMIT 1", (norm,)
            ).fetchone()
            result.append(row[0])
        return result
