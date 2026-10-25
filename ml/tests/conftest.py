from pathlib import Path

import pytest

from mtgar_data.card_db import CardDatabase
from mtgar_data.json_stream import iter_json_array
from mtgar_data.model_resolver import ModelResolver

FIXTURES = Path(__file__).parent / "fixtures"
MODEL_MAP = Path(__file__).parents[1] / "config" / "model_map.json"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture
def db(tmp_path) -> CardDatabase:
    database = CardDatabase.create(tmp_path / "cards.db")
    for card in iter_json_array(FIXTURES / "oracle_cards.json"):
        database.add_card(card)
    for card in iter_json_array(FIXTURES / "unique_artwork.json"):
        database.add_artwork(card)
    for card in iter_json_array(FIXTURES / "all_cards.json"):
        database.add_printed_names(card)
    database.commit()
    yield database
    database.close()


@pytest.fixture
def resolver() -> ModelResolver:
    return ModelResolver.from_file(MODEL_MAP)
