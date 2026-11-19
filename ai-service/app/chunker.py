from typing import List


def chunk_text(text: str, chunk_size: int = 120, overlap: int = 25) -> List[str]:
    """
    Divide un documento técnico en fragmentos basados en palabras con solapamiento
    para preservar el contexto semántico entre párrafos.
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