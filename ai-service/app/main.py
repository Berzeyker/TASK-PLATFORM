from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.schemas import (
    HealthResponse,
    IngestArticleRequest,
    IngestArticleResponse,
    TroubleshootRequest,
    TroubleshootResponse,
)
from app.rag_engine import (
    get_indexed_count,
    index_article,
    delete_article,
    troubleshoot_problem,
)

app = FastAPI(
    title=settings.app_name,
    description="Microservicio autónomo orientado a SOA para búsqueda semántica RAG y soporte técnico asistido por IA.",
    version=settings.app_version,
)

# Permitir peticiones desde el backend Node.js y el dashboard React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["System"])
def health_check():
    return HealthResponse(
        status="online",
        service=settings.app_name,
        version=settings.app_version,
        llm_provider=settings.llm_provider,
        indexed_chunks=get_indexed_count(),
    )


@app.post("/api/v1/knowledge/index", response_model=IngestArticleResponse, tags=["Knowledge Base"])
def ingest_knowledge_article(payload: IngestArticleRequest):
    try:
        return index_article(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error al indexar artículo: {str(exc)}")


@app.delete("/api/v1/knowledge/{article_id}", tags=["Knowledge Base"])
def remove_knowledge_article(article_id: str):
    deleted = delete_article(article_id)
    return {"status": "deleted", "article_id": article_id, "chunks_removed": deleted}


@app.post("/api/v1/rag/troubleshoot", response_model=TroubleshootResponse, tags=["RAG Assistant"])
def troubleshoot_support_request(payload: TroubleshootRequest):
    try:
        return troubleshoot_problem(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error en el motor RAG: {str(exc)}")