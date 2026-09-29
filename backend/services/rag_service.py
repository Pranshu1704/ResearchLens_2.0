from threading import Lock

from sentence_transformers import SentenceTransformer, util


MODEL_NAME = "all-MiniLM-L6-v2"

# Lazy-load the embedding model. It is no longer loaded during FastAPI startup.
_embedding_model = None
_embedding_model_lock = Lock()


def get_embedding_model():
    global _embedding_model

    if _embedding_model is None:
        with _embedding_model_lock:
            if _embedding_model is None:
                print("Loading embedding model on first RAG request...")
                _embedding_model = SentenceTransformer(MODEL_NAME)
                print("Embedding model loaded.")

    return _embedding_model


def chunk_text(
    text: str,
    chunk_size: int = 1200,
    overlap: int = 200,
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


def build_paper_index(text: str) -> dict:
    chunks = chunk_text(text)

    if not chunks:
        return {
            "chunks": [],
            "embeddings": None,
        }

    model = get_embedding_model()

    print(
        "Creating embeddings for",
        len(chunks),
        "chunks...",
    )

    embeddings = model.encode(
        chunks,
        convert_to_tensor=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    return {
        "chunks": chunks,
        "embeddings": embeddings,
    }


def retrieve_relevant_chunks(
    paper_index: dict,
    question: str,
    top_k: int = 5,
) -> list[str]:
    chunks = paper_index.get("chunks", [])
    embeddings = paper_index.get("embeddings")

    if not chunks or embeddings is None:
        return []

    model = get_embedding_model()

    query_embedding = model.encode(
        question,
        convert_to_tensor=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    scores = util.cos_sim(
        query_embedding,
        embeddings,
    )[0]

    ranked_indices = scores.argsort(
        descending=True
    ).tolist()

    selected_chunks = []

    for index in ranked_indices[:top_k]:
        selected_chunks.append(chunks[index])

    return selected_chunks
