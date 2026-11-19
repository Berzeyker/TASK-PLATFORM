from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "T.A.S.K. AI & RAG Microservice"
    app_version: str = "1.0.0"
    port: int = 8001

    # Configuración de LLM (Groq + Fallback Ollama)
    llm_provider: str = "groq"
    groq_api_key: str = ""
    groq_main_model: str = "llama-3.3-70b-versatile"
    groq_fast_model: str = "llama-3.1-8b-instant"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"

    # Configuración RAG & ChromaDB
    embedding_model: str = "all-MiniLM-L6-v2"
    chroma_persist_dir: str = "./chroma_db"
    collection_name: str = "it_knowledge_base"
    similarity_threshold: float = 0.70

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()