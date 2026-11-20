from typing import List


def chunk_text(text: str, chunk_size: int = 22, overlap: int = 5) -> List[str]:
    """
    Divide el documento en fragmentos cortos para que el primer bloque aísle
    los síntomas del problema y maximice la similitud semántica.
    """
    cleaned = " ".join(text.split())
    if not cleaned:
        return []

    words = cleaned.split(" ")
    if len(words) <= chunk_size:
        return [cleaned]

    chunks: List[str] = []
    start = 0
    step = max(1, chunk_size - overlap)

    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end >= len(words):
            break
        start += step

    return chunks