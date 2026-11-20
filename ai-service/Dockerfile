FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

# Instalar PyTorch CPU-only para reducir el peso de la imagen
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-descargar el modelo de embeddings durante el build
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

COPY app ./app
COPY data ./data
COPY scripts ./scripts

EXPOSE 8001

CMD ["sh", "-c", "python scripts/seed_db.py && uvicorn app.main:app --host 0.0.0.0 --port 8001"]