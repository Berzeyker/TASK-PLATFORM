export interface SourceCitation {
    article_id: string;
    title: string;
    category: string;
    similarity_score: number;
}

export interface TroubleshootRequest {
    title: string;
    description: string;
    top_k?: number;
}

export interface TroubleshootResponse {
    resolved_by_ai: boolean;
    suggested_category: string | null;
    confidence: number;
    suggestion: string | null;
    sources: SourceCitation[];
    should_escalate: boolean;
    escalation_reason: string | null;
}

export interface IngestArticleRequest {
    article_id: string;
    title: string;
    category: string;
    content: string;
}

export interface IngestArticleResponse {
    status: string;
    article_id: string;
    chunks_indexed: number;
}

export interface AiServiceHealth {
    status: string;
    service: string;
    version: string;
    llm_provider: string;
    indexed_chunks: number;
}