import io
import json

import pytest

from mtgar_data.json_stream import iter_json_array, iter_json_array_stream


def _read(text, chunk_size):
    return list(iter_json_array_stream(io.StringIO(text), chunk_size=chunk_size))


DATA = [{"name": "Llanowar Elves", "power": "1"}, {"name": "Fire // Ice", "colors": ["R", "U"]}, 123, "texto", None]


@pytest.mark.parametrize("chunk_size", [1, 2, 3, 7, 64, 1 << 20])
def test_objects_split_across_chunks(chunk_size):
    text = json.dumps(DATA, indent=2)
    assert _read(text, chunk_size) == DATA


def test_numbers_at_chunk_boundary_are_not_truncated():
    assert _read("[12345, 678]", chunk_size=3) == [12345, 678]


def test_empty_array():
    assert _read("  [ ]  ", chunk_size=1) == []


def test_not_an_array():
    with pytest.raises(ValueError):
        _read('{"a": 1}', chunk_size=4)


def test_truncated_file():
    with pytest.raises(ValueError):
        _read('[{"a": 1}, {"b":', chunk_size=4)


def test_file_with_bom(tmp_path):
    path = tmp_path / "bom.json"
    path.write_text("﻿" + json.dumps(DATA), encoding="utf-8")
    assert list(iter_json_array(path)) == DATA
