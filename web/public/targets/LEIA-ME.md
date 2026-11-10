# Alvos do modo Cartas

Coloque aqui os dois arquivos gerados em `compilar.html`:

- `targets.mind`: as imagens das cartas compiladas pelo MindAR;
- `targets.json`: a lista de nomes, na mesma ordem: `[{ "name": "Llanowar Elves" }, ...]`.

Imagens das cartas: `python ml/scripts/download_card_image.py "Llanowar Elves" "Shivan Dragon" --out ref_images`.
Comece com 5 a 20 cartas; quanto mais alvos, mais lento o reconhecimento.
