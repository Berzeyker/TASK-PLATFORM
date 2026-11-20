import { config } from '../config';
import { prisma } from '../prisma';

export interface AiSourceCitation {
  article_id: string;
  title: string;
  category: string;
  similarity_score: number;
}

export interface AiTroubleshootResult {
  resolved_by_ai: boolean;
  suggested_category: string | null;
  confidence: number;
  suggestion: string | null;
  sources: AiSourceCitation[];
  should_escalate: boolean;
  escalation_reason: string | null;
}

/**
 * Sincroniza los artículos publicados de Prisma con ChromaDB en el microservicio FastAPI (AIR-06).
 * Nunca lanza excepciones no controladas para evitar bloquear la gestión de artículos si IA está offline.
 */
export async function syncArticleIndex(articleId: number, action: 'index' | 'remove'): Promise<void> {
  const vectorId = `KB-${articleId}`;

  try {
    if (action === 'remove') {
      const response = await fetch(`${config.aiServiceUrl}/api/v1/knowledge/${vectorId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.warn(`[vectorStore] Falló eliminación de ${vectorId}: HTTP ${response.status}`);
      }
      return;
    }

    const article = await prisma.kbArticle.findUnique({ where: { id: articleId } });
    if (!article || article.status !== 'PUBLISHED') return;

    const response = await fetch(`${config.aiServiceUrl}/api/v1/knowledge/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: vectorId,
        title: article.title,
        category: article.categoryId ? `Category-${article.categoryId}` : 'General',
        content: article.content,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[vectorStore] Falló indexación de ${vectorId}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(`[vectorStore] Microservicio IA no disponible durante '${action}' de ${vectorId}:`, error);
  }
}

/**
 * Orquesta la consulta de diagnóstico RAG con timeout estricto (< 10s, NFR-06)
 * y fallback seguro para permitir creación normal de tickets en caso de falla.
 */
export async function troubleshootWithAi(
  title: string,
  description: string,
  topK = 3
): Promise<AiTroubleshootResult> {
  try {
    const response = await fetch(`${config.aiServiceUrl}/api/v1/rag/troubleshoot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, top_k: topK }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`AI Service HTTP ${response.status}`);
    }

    return (await response.json()) as AiTroubleshootResult;
  } catch (error) {
    console.warn('[vectorStore] Fallback activado en troubleshootWithAi:', error);
    return {
      resolved_by_ai: false,
      suggested_category: null,
      confidence: 0,
      suggestion: null,
      sources: [],
      should_escalate: true,
      escalation_reason: 'El asistente de IA no está disponible en este momento; proceda a crear el ticket.',
    };
  }
}