// Hook for the AI/RAG service (FastAPI + ChromaDB). It is a no-op until that service exists.
// When an article is Published it must be chunked and embedded; when it is unpublished or
// archived its chunks must be removed (AIR-06: only published, approved content is retrievable).
export async function syncArticleIndex(articleId: number, action: 'index' | 'remove'): Promise<void> {
  console.log(`[vectorStore] ${action} article ${articleId} (not wired yet)`);
}
