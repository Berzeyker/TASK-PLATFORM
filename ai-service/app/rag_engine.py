import httpx
import chromadb
from sentence_transformers import SentenceTransformer
from groq import Groq

from app.config import settings
from app.sanitizer import sanitize_text
from app.chunker import chunk_text
from app.schemas import (
    IngestArticleRequest,
    IngestArticleResponse,
    TroubleshootRequest,
    TroubleshootResponse,
    SourceCitation,
)

# 1. Inicializar ChromaDB persistente con espacio métrico de coseno
chroma_client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
collection = chroma_client.get_or_create_collection(
    name=settings.collection_name,
    metadata={"hnsw:space": "cosine"},
)

# 2. Cargar modelo ligero de embeddings en CPU (sin necesidad de GPU)
embedder = SentenceTransformer(settings.embedding_model)

# 3. Inicializar cliente de Groq
groq_client = Groq(api_key=settings.groq_api_key) if settings.groq_api_key else None


def get_indexed_count() -> int:
    return collection.count()


def index_article(payload: IngestArticleRequest) -> IngestArticleResponse:
    """
    Sanitiza, fragmenta, vectoriza e indexa un artículo aprobado de la Knowledge Base.
    Si el artículo ya existía, reemplaza sus fragmentos anteriores.
    """
    clean_title = sanitize_text(payload.title)
    clean_content = sanitize_text(payload.content)

    # Eliminar fragmentos previos del mismo artículo para evitar duplicados al editar
    existing = collection.get(where={"article_id": payload.article_id})
    if existing and existing["ids"]:
        collection.delete(ids=existing["ids"])

    chunks = chunk_text(clean_content)
    if not chunks:
        return IngestArticleResponse(status="empty", article_id=payload.article_id, chunks_indexed=0)

    ids = []
    embeddings = []
    documents = []
    metadatas = []

    for idx, chunk in enumerate(chunks):
        enriched_text = f"Title: {clean_title} | Category: {payload.category}\n{chunk}"
        vector = embedder.encode(enriched_text).tolist()

        ids.append(f"{payload.article_id}_chunk_{idx}")
        embeddings.append(vector)
        documents.append(enriched_text)
        metadatas.append(
            {
                "article_id": payload.article_id,
                "title": clean_title,
                "category": payload.category,
                "chunk_index": idx,
            }
        )

    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )

    return IngestArticleResponse(
        status="indexed",
        article_id=payload.article_id,
        chunks_indexed=len(ids),
    )


def delete_article(article_id: str) -> int:
    existing = collection.get(where={"article_id": article_id})
    if existing and existing["ids"]:
        collection.delete(ids=existing["ids"])
        return len(existing["ids"])
    return 0


def _call_llm(system_prompt: str, user_prompt: str) -> str:
    """
    Ejecuta inferencia en Groq Cloud o hace fallback a Ollama local según configuración.
    """
    if settings.llm_provider.lower() == "ollama":
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "stream": False,
                "options": {"temperature": 0.1},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()["message"]["content"].strip()

    if not groq_client:
        raise RuntimeError("GROQ_API_KEY no está configurada en el entorno.")

    completion = groq_client.chat.completions.create(
        model=settings.groq_main_model,
        temperature=0.1,
        max_tokens=700,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return (completion.choices[0].message.content or "").strip()


def troubleshoot_problem(payload: TroubleshootRequest) -> TroubleshootResponse:
    """
    Ejecuta el flujo completo RAG: sanitización -> búsqueda semántica -> filtro de umbral -> generación.
    """
    if collection.count() == 0:
        return TroubleshootResponse(
            resolved_by_ai=False,
            confidence=0.0,
            should_escalate=True,
            escalation_reason="La base de conocimiento vectorial está vacía.",
        )

    raw_query = f"{payload.title}. {payload.description}"
    clean_query = sanitize_text(raw_query)
    query_vector = embedder.encode(clean_query).tolist()

    n_results = min(payload.top_k, collection.count())
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=n_results,
    )

    docs = results["documents"][0] if results["documents"] else []
    metas = results["metadatas"][0] if results["metadatas"] else []
    distances = results["distances"][0] if results["distances"] else []

    if not docs:
        return TroubleshootResponse(
            resolved_by_ai=False,
            confidence=0.0,
            should_escalate=True,
            escalation_reason="No se encontraron documentos coincidentes.",
        )

    # En distancia coseno de ChromaDB: similitud = 1 - distancia
    similarities = [round(max(0.0, min(1.0, 1.0 - d)), 2) for d in distances]
    best_score = similarities[0]
    inferred_category = metas[0].get("category")

    # Regla BR-04: Escalamiento automático si la confianza es inferior al umbral (0.70)
    if best_score < settings.similarity_threshold:
        return TroubleshootResponse(
            resolved_by_ai=False,
            suggested_category=inferred_category,
            confidence=best_score,
            should_escalate=True,
            escalation_reason=f"Similitud semántica ({best_score}) inferior al umbral permitido ({settings.similarity_threshold}).",
        )

    # Construir contexto y deduplicar citas por article_id
    context_blocks = []
    unique_sources: dict[str, SourceCitation] = {}

    for i, doc in enumerate(docs):
        score = similarities[i]
        if score >= 0.55:
            art_id = str(metas[i]["article_id"])
            title = str(metas[i]["title"])
            category = str(metas[i]["category"])

            context_blocks.append(f"[Source Title: {title}]\n{doc}")

            if art_id not in unique_sources or score > unique_sources[art_id].similarity_score:
                unique_sources[art_id] = SourceCitation(
                    article_id=art_id,
                    title=title,
                    category=category,
                    similarity_score=score,
                )

    context_str = "\n\n---\n\n".join(context_blocks)

    system_prompt = (
        "You are an enterprise IT Support Assistant for the T.A.S.K. Platform.\n"
        "STRICT SAFETY & GROUNDING RULES:\n"
        "1. Answer ONLY using the provided [Source Title] context below.\n"
        "2. Respond in the same language as the user's problem description.\n"
        "3. Present clear, numbered troubleshooting steps.\n"
        "4. Cite the exact Source Title(s) at the end of your response.\n"
        "5. NEVER invent commands, URLs, passwords, or procedures outside the context.\n"
        "6. NEVER suggest destructive actions (formatting drives, deleting system directories).\n"
        "7. If the context does not directly solve the problem, reply ONLY with: INSUFFICIENT_CONTEXT"
    )

    user_prompt = f"Authorized Knowledge Base Context:\n{context_str}\n\nEmployee Issue:\n{clean_query}"

    ai_reply = _call_llm(system_prompt, user_prompt)

    if "INSUFFICIENT_CONTEXT" in ai_reply:
        return TroubleshootResponse(
            resolved_by_ai=False,
            suggested_category=inferred_category,
            confidence=best_score,
            should_escalate=True,
            escalation_reason="El modelo determinó que los artículos recuperados no resuelven exactamente la falla.",
        )

    return TroubleshootResponse(
        resolved_by_ai=True,
        suggested_category=inferred_category,
        confidence=best_score,
        suggestion=ai_reply,
        sources=list(unique_sources.values()),
        should_escalate=False,
    )