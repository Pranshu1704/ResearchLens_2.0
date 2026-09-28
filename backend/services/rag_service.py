import hashlib
import json
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer


MODEL_NAME = "all-MiniLM-L6-v2"

# RAG cache is kept inside the backend project.
CACHE_DIR = Path("rag_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_embedding_model = None


def get_embedding_model():
    global _embedding_model

    if _embedding_model is None:
        print("Loading embedding model...")
        _embedding_model = SentenceTransformer(MODEL_NAME)
        print("Embedding model loaded.")

    return _embedding_model


def chunk_text(
    text: str,
    chunk_size: int = 1200,
    overlap: int = 200
) -> list[str]:
    text = " ".join(text.split())

    if not text:
        return []

    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = min(start + chunk_size, text_length)
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= text_length:
            break

        start = max(end - overlap, start + 1)

    return chunks


def _cache_key(text: str) -> str:
    text_hash = hashlib.sha256(
        text.encode("utf-8")
    ).hexdigest()

    model_hash = hashlib.sha256(
        MODEL_NAME.encode("utf-8")
    ).hexdigest()[:12]

    return f"{text_hash}_{model_hash}"


def _cache_paths(text: str):
    key = _cache_key(text)

    metadata_path = CACHE_DIR / f"{key}.json"
    embeddings_path = CACHE_DIR / f"{key}.npy"

    return metadata_path, embeddings_path


def _save_cache(
    metadata_path: Path,
    embeddings_path: Path,
    chunks: list[str],
    embeddings: np.ndarray
):
    metadata = {
        "model_name": MODEL_NAME,
        "chunk_count": len(chunks),
        "chunks": chunks,
    }

    metadata_temp = metadata_path.with_suffix(".json.tmp")
    embeddings_temp = embeddings_path.with_suffix(".npy.tmp")

    metadata_temp.write_text(
        json.dumps(metadata, ensure_ascii=False),
        encoding="utf-8"
    )

    with embeddings_temp.open("wb") as file:
        np.save(file, embeddings.astype(np.float32))

    metadata_temp.replace(metadata_path)
    embeddings_temp.replace(embeddings_path)


def _load_cache(text: str):
    metadata_path, embeddings_path = _cache_paths(text)

    if not metadata_path.exists() or not embeddings_path.exists():
        return None

    try:
        metadata = json.loads(
            metadata_path.read_text(encoding="utf-8")
        )

        if metadata.get("model_name") != MODEL_NAME:
            return None

        chunks = metadata.get("chunks", [])

        embeddings = np.load(
            embeddings_path,
            allow_pickle=False
        )

        if len(chunks) != len(embeddings):
            return None

        print(
            "Loaded RAG index from cache:",
            len(chunks),
            "chunks"
        )

        return {
            "chunks": chunks,
            "embeddings": embeddings
        }

    except Exception as error:
        print("RAG cache load failed:", repr(error))
        return None


def build_paper_index(text: str) -> dict:
    cached_index = _load_cache(text)

    if cached_index is not None:
        return cached_index

    chunks = chunk_text(text)

    if not chunks:
        return {
            "chunks": [],
            "embeddings": None
        }

    model = get_embedding_model()

    print(
        "Creating embeddings for",
        len(chunks),
        "chunks..."
    )

    embeddings = model.encode(
        chunks,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False
    ).astype(np.float32)

    metadata_path, embeddings_path = _cache_paths(text)

    _save_cache(
        metadata_path,
        embeddings_path,
        chunks,
        embeddings
    )

    print(
        "RAG index cached:",
        len(chunks),
        "chunks"
    )

    return {
        "chunks": chunks,
        "embeddings": embeddings
    }


def retrieve_relevant_chunks(
    paper_index: dict,
    question: str,
    top_k: int = 5
) -> list[str]:
    chunks = paper_index.get("chunks", [])
    embeddings = paper_index.get("embeddings")

    if not chunks or embeddings is None:
        return []

    model = get_embedding_model()

    query_embedding = model.encode(
        [question],
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False
    )[0].astype(np.float32)

    # Because both vectors are normalized, dot product is cosine similarity.
    scores = embeddings @ query_embedding

    top_k = min(top_k, len(chunks))

    ranked_indices = np.argsort(scores)[::-1][:top_k]

    return [
        chunks[index]
        for index in ranked_indices
    ]
