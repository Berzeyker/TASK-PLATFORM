import { apiRequest } from '../auth/api'
import type { TroubleshootRequest, TroubleshootResponse } from './types'

/**
 * Consulta el motor RAG del backend, que a su vez habla con el microservicio
 * de IA (FastAPI + ChromaDB + Groq/Ollama). El backend responde con un
 * fallback de escalamiento si la IA no está disponible, así que un error de
 * red aquí solo ocurre si el backend mismo no responde.
 */
export function askAssistant(token: string, input: TroubleshootRequest): Promise<TroubleshootResponse> {
  return apiRequest<TroubleshootResponse>('/kb/troubleshoot', {
    token,
    method: 'POST',
    body: input,
    timeoutMs: 30000,
  })
}
