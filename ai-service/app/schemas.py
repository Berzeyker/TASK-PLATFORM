from typing import List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    llm_provider: str
    indexed_chunks: int


class IngestArticleRequest(BaseModel):
    article_id: str = Field(..., min_length=1, description="ID único del artículo en PostgreSQL")
    title: str = Field(..., min_length=3, description="Título del manual o guía técnica")
    category: str = Field(..., min_length=2, description="Categoría técnica (ej. Redes, Hardware, Software)")
    content: str = Field(..., min_length=10, description="Contenido completo en Markdown o texto plano")
    symptoms: Optional[List[str]] = Field(
        default=None,
        description="Frases con las que los empleados describen el problema (mejora el emparejamiento semántico)",
    )


class IngestArticleResponse(BaseModel):
    status: str
    article_id: str
    chunks_indexed: int


class TroubleshootRequest(BaseModel):
    title: str = Field(..., min_length=3, description="Título breve del problema")
    description: str = Field(..., min_length=5, description="Descripción detallada de la falla")
    top_k: int = Field(default=3, ge=1, le=5, description="Número máximo de fragmentos a recuperar")


class SourceCitation(BaseModel):
    article_id: str
    title: str
    category: str
    similarity_score: float


class TroubleshootResponse(BaseModel):
    resolved_by_ai: bool
    suggested_category: Optional[str] = None
    confidence: float
    suggestion: Optional[str] = None
    sources: List[SourceCitation] = []
    should_escalate: bool
    escalation_reason: Optional[str] = None