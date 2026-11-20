import json
import os
import sys
from pathlib import Path

# Asegurar que el directorio raíz de ai-service esté en el path y sea el directorio activo
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
os.chdir(BASE_DIR)

from app.schemas import IngestArticleRequest
from app.rag_engine import index_article, get_indexed_count


def run_seed():
    seed_file = BASE_DIR / "data" / "seed_manuals.json"
    if not seed_file.exists():
        print(f"Error: No se encontró el archivo {seed_file}")
        return

    with open(seed_file, "r", encoding="utf-8") as f:
        manuals = json.load(f)

    print(f"Iniciando indexación de {len(manuals)} manuales técnicos en ChromaDB...\n")

    for item in manuals:
        request = IngestArticleRequest(
            article_id=item["article_id"],
            title=item["title"],
            category=item["category"],
            content=item["content"],
        )
        result = index_article(request)
        print(f"[OK] {result.article_id} -> '{item['title']}' ({result.chunks_indexed} chunks indexados)")

    print(f"\nCarga finalizada. Total de fragmentos en ChromaDB: {get_indexed_count()}")


if __name__ == "__main__":
    run_seed()