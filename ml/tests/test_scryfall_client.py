import io
import json
import urllib.error

import pytest

from mtgar_data.scryfall_client import ScryfallClient, ScryfallError, slugify


class FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, headers=None):
        super().__init__(body)
        self.headers = headers or {}


class FakeOpener:
    """Simula a rede: cada URL tem uma fila de respostas (bytes, dict ou exceção)."""

    def __init__(self, routes):
        self.routes = {url: list(items) for url, items in routes.items()}
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        item = self.routes[request.full_url].pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, (dict, list)):
            item = json.dumps(item).encode()
        return FakeResponse(item)


def http_error(url, code, headers=None, body=b""):
    return urllib.error.HTTPError(url, code, "erro", headers or {}, io.BytesIO(body))


BULK_URL = "https://api.scryfall.com/bulk-data"
FILE_URL = "https://data.scryfall.io/oracle-cards/oracle-cards-20261022.json"
BULK_INDEX = {"data": [{"type": "oracle_cards", "download_uri": FILE_URL, "updated_at": "2026-10-22T09:00:00+00:00", "size": 11}]}


def make_client(routes):
    sleeps = []
    opener = FakeOpener(routes)
    client = ScryfallClient(opener=opener, sleep=sleeps.append, clock=lambda: 0.0)
    return client, opener, sleeps


def test_headers_are_sent():
    client, opener, _ = make_client({BULK_URL: [BULK_INDEX]})
    client.list_bulk_data()
    request = opener.requests[0]
    assert "mtg-ar" in request.get_header("User-agent")
    assert request.get_header("Accept").startswith("application/json")


def test_rate_limit_waits_between_requests():
    client, _, sleeps = make_client({BULK_URL: [BULK_INDEX, BULK_INDEX]})
    client.list_bulk_data()
    client.list_bulk_data()
    assert sleeps == [pytest.approx(0.1)]


def test_retries_with_backoff_then_succeeds():
    client, _, sleeps = make_client({BULK_URL: [
        urllib.error.URLError("conexão recusada"),
        http_error(BULK_URL, 503),
        http_error(BULK_URL, 429, headers={"Retry-After": "1"}),
        BULK_INDEX,
    ]})
    assert client.find_bulk("oracle_cards")["download_uri"] == FILE_URL
    retry_sleeps = [s for s in sleeps if s >= 1]
    assert retry_sleeps == [2, 4, 1]  # backoff 2, 4 e depois respeita o Retry-After


def test_gives_up_after_max_retries():
    client, _, _ = make_client({BULK_URL: [urllib.error.URLError("sem rede")] * 5})
    with pytest.raises(ScryfallError, match="não foi possível acessar"):
        client.list_bulk_data()


def test_client_errors_are_not_retried_and_show_details():
    url = "https://api.scryfall.com/cards/named?fuzzy=Llanowar+Elfz"
    body = json.dumps({"details": "No cards found matching"}).encode()
    client, opener, _ = make_client({url: [http_error(url, 404, body=body)]})
    with pytest.raises(ScryfallError, match="404.*No cards found"):
        client.card_named("Llanowar Elfz", exact=False)
    assert len(opener.requests) == 1


def test_download_bulk_and_skip_when_up_to_date(tmp_path):
    client, opener, _ = make_client({BULK_URL: [BULK_INDEX, BULK_INDEX], FILE_URL: [b'[{"a": 1}]\n']})
    progress = []
    path, downloaded = client.download_bulk("oracle_cards", tmp_path, progress=lambda d, t: progress.append((d, t)))
    assert downloaded and path.read_bytes() == b'[{"a": 1}]\n'
    assert progress[-1] == (11, 11)
    assert not (tmp_path / "oracle_cards.json.part").exists()

    path2, downloaded2 = client.download_bulk("oracle_cards", tmp_path)
    assert path2 == path and not downloaded2
    assert [r.full_url for r in opener.requests].count(FILE_URL) == 1


def test_unknown_bulk_type():
    client, _, _ = make_client({BULK_URL: [BULK_INDEX]})
    with pytest.raises(ScryfallError, match="desconhecido"):
        client.find_bulk("nao_existe")


def test_download_card_image_double_faced(tmp_path):
    named = "https://api.scryfall.com/cards/named?fuzzy=delver"
    card = {"name": "Delver of Secrets // Insectile Aberration", "card_faces": [
        {"name": "Delver of Secrets", "image_uris": {"large": "https://cards.scryfall.io/large/front/a.jpg"}},
        {"name": "Insectile Aberration", "image_uris": {"large": "https://cards.scryfall.io/large/back/a.jpg"}},
    ]}
    client, _, _ = make_client({
        named: [card],
        "https://cards.scryfall.io/large/front/a.jpg": [b"front"],
        "https://cards.scryfall.io/large/back/a.jpg": [b"back"],
    })
    paths = client.download_card_image("delver", tmp_path)
    assert [p.name for p in paths] == ["delver_of_secrets_face0.jpg", "insectile_aberration_face1.jpg"]
    assert paths[1].read_bytes() == b"back"


def test_slugify():
    assert slugify("Jötun Grunt") == "jotun_grunt"
    assert slugify("Fire // Ice") == "fire_ice"
