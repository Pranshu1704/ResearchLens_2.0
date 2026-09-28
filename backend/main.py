from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
import os
import time
import re
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from services.vision_service import explain_image
from services.pdf_service import extract_text_from_pdf
from services.gemini_service import (
    summarize_research_paper,
    ask_question_with_context,
)
from services.image_services import extract_images_from_pdf
from services.rag_service import (
    build_paper_index,
    retrieve_relevant_chunks,
)


# =========================
# CONFIGURATION
# =========================

BASE_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BASE_DIR / "uploads"

MAX_FILE_SIZE = 50 * 1024 * 1024
ALLOWED_EXTENSION = ".pdf"

UPLOAD_RETENTION_HOURS = 24
RAG_CACHE_RETENTION_DAYS = 30

RATE_LIMIT_WINDOW_SECONDS = 10 * 60

RATE_LIMITS = {
    "summarize-pdf": 5,
    "chat-with-paper": 30,
    "analyze-image": 20,
}

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# =========================
# REQUEST MODELS
# =========================

class ImageAnalysisRequest(BaseModel):
    image_path: str


class ChatMessage(BaseModel):
    role: str
    content: str


class PaperChatRequest(BaseModel):
    paper_id: str
    question: str
    chat_history: list[ChatMessage] = Field(default_factory=list)


_rate_limit_store = defaultdict(deque)


def get_client_ip(request: Request) -> str:
    if request.client is None:
        return "unknown"

    return request.client.host or "unknown"


def enforce_rate_limit(
    request: Request,
    bucket: str,
    limit: int,
) -> None:
    now = time.time()
    key = f"{get_client_ip(request)}:{bucket}"
    timestamps = _rate_limit_store[key]

    while timestamps and (
        now - timestamps[0] >= RATE_LIMIT_WINDOW_SECONDS
    ):
        timestamps.popleft()

    if len(timestamps) >= limit:
        retry_after = max(
            1,
            int(
                RATE_LIMIT_WINDOW_SECONDS
                - (now - timestamps[0])
            ),
        )

        raise HTTPException(
            status_code=429,
            detail=(
                "Too many requests. "
                "Please wait and try again."
            ),
            headers={
                "Retry-After": str(retry_after),
            },
        )

    timestamps.append(now)


def cleanup_rate_limit_store() -> None:
    now = time.time()
    stale_keys = []

    for key, timestamps in _rate_limit_store.items():
        while timestamps and (
            now - timestamps[0] >= RATE_LIMIT_WINDOW_SECONDS
        ):
            timestamps.popleft()

        if not timestamps:
            stale_keys.append(key)

    for key in stale_keys:
        _rate_limit_store.pop(key, None)


def _remove_directory(directory: Path) -> None:
    try:
        shutil.rmtree(directory)
    except FileNotFoundError:
        pass
    except OSError as error:
        print(
            "Could not remove runtime directory:",
            directory,
            repr(error),
        )


def cleanup_stale_uploads() -> None:
    if not UPLOADS_DIR.exists():
        return

    cutoff = time.time() - (
        UPLOAD_RETENTION_HOURS * 60 * 60
    )

    removed = 0

    for path in UPLOADS_DIR.iterdir():
        if not path.is_dir():
            continue

        if path.name in paper_store:
            continue

        try:
            if path.stat().st_mtime < cutoff:
                _remove_directory(path)
                removed += 1
        except OSError as error:
            print(
                "Could not inspect upload directory:",
                path,
                repr(error),
            )

    if removed:
        print(
            "Startup cleanup removed",
            removed,
            "old upload director(y/ies).",
        )


def cleanup_stale_rag_cache() -> None:
    cache_dir = BASE_DIR / "rag_cache"

    if not cache_dir.exists():
        return

    cutoff = time.time() - (
        RAG_CACHE_RETENTION_DAYS * 24 * 60 * 60
    )

    removed = 0

    for path in cache_dir.iterdir():
        if not path.is_file():
            continue

        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError as error:
            print(
                "Could not remove RAG cache file:",
                path,
                repr(error),
            )

    if removed:
        print(
            "Startup cleanup removed",
            removed,
            "stale RAG cache file(s).",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Running ResearchLens startup cleanup...")

    cleanup_stale_uploads()
    cleanup_stale_rag_cache()

    print("ResearchLens startup cleanup complete.")

    yield


# =========================
# APP
# =========================

app = FastAPI(
    title="ResearchLens API",
    description="AI-powered research paper analysis platform",
    version="1.2.0",
    lifespan=lifespan,
)


frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"

    return response


app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOADS_DIR)),
    name="uploads",
)


# Development/demo storage.
paper_store = {}
paper_index_store = {}


# =========================
# HELPERS
# =========================

def sanitize_filename(filename: str | None) -> str:
    original = Path(filename or "").name

    # Replace anything outside a safe filename set.
    safe_name = re.sub(
        r"[^A-Za-z0-9._-]+",
        "_",
        original,
    ).strip("._")

    if not safe_name:
        safe_name = "research-paper.pdf"

    return safe_name


def validate_pdf_filename(filename: str) -> str:
    safe_name = sanitize_filename(filename)

    if not safe_name.lower().endswith(ALLOWED_EXTENSION):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed.",
        )

    return safe_name


def is_safe_upload_path(path: Path) -> bool:
    try:
        path.resolve().relative_to(UPLOADS_DIR.resolve())
        return True
    except ValueError:
        return False


async def save_upload(file: UploadFile, destination: Path) -> None:
    total_size = 0

    with destination.open("wb") as buffer:
        while True:
            chunk = await file.read(1024 * 1024)

            if not chunk:
                break

            total_size += len(chunk)

            if total_size > MAX_FILE_SIZE:
                buffer.close()

                try:
                    destination.unlink()
                except FileNotFoundError:
                    pass

                raise HTTPException(
                    status_code=413,
                    detail="PDF file is larger than 50 MB.",
                )

            buffer.write(chunk)


def validate_pdf_signature(file_path: Path) -> None:
    with file_path.open("rb") as pdf_file:
        signature = pdf_file.read(5)

    if signature != b"%PDF-":
        try:
            file_path.unlink()
        except FileNotFoundError:
            pass

        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid PDF.",
        )


def cleanup_original_pdf(file_path: Path) -> None:
    try:
        if file_path.exists():
            file_path.unlink()
    except OSError as error:
        print(
            "Could not remove temporary PDF:",
            repr(error)
        )


def create_analysis_directory() -> tuple[str, Path]:
    analysis_id = str(uuid.uuid4())
    analysis_dir = UPLOADS_DIR / analysis_id
    analysis_dir.mkdir(parents=True, exist_ok=True)

    return analysis_id, analysis_dir


# =========================
# HEALTH
# =========================

@app.get("/")
def home():
    return {
        "message": "Welcome to ResearchLens API",
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
    }


# =========================
# PDF UPLOAD
# =========================

@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    filename = validate_pdf_filename(file.filename)

    analysis_id, analysis_dir = create_analysis_directory()
    file_path = analysis_dir / filename

    try:
        await save_upload(file, file_path)
        validate_pdf_signature(file_path)

        extracted_text = extract_text_from_pdf(str(file_path))

        return {
            "filename": filename,
            "characters_extracted": len(extracted_text),
            "preview": extracted_text[:500],
        }

    finally:
        cleanup_original_pdf(file_path)

        try:
            analysis_dir.rmdir()
        except OSError:
            pass


# =========================
# PDF ANALYSIS
# =========================

@app.post("/summarize-pdf")
async def summarize_pdf(
    request: Request,
    file: UploadFile = File(...),
):
    enforce_rate_limit(
        request,
        "summarize-pdf",
        RATE_LIMITS["summarize-pdf"],
    )
    cleanup_rate_limit_store()

    analysis_id, analysis_dir = create_analysis_directory()

    try:
        filename = validate_pdf_filename(file.filename)
        file_path = analysis_dir / filename

        await save_upload(file, file_path)
        validate_pdf_signature(file_path)

        extracted_text = extract_text_from_pdf(str(file_path))

        if not extracted_text.strip():
            raise HTTPException(
                status_code=400,
                detail="No text could be extracted from this PDF.",
            )

        extracted_images = extract_images_from_pdf(
            str(file_path)
        )

        print("Image extraction function executed")
        print("Extracted images:", extracted_images)

        image_results = [
            {
                "image_url": (
                    f"/uploads/{analysis_id}/extracted_images/"
                    f"{Path(image_path).name}"
                ),
                "image_path": image_path,
            }
            for image_path in extracted_images
        ]

        summary = summarize_research_paper(
            extracted_text
        )

        paper_store[analysis_id] = {
            "filename": filename,
            "text": extracted_text,
        }

        print(
            "Building semantic index for the research paper..."
        )

        paper_index_store[analysis_id] = build_paper_index(
            extracted_text
        )

        print(
            "Semantic index ready. Chunks:",
            len(
                paper_index_store[analysis_id].get(
                    "chunks",
                    []
                )
            ),
        )

        response_data = {
            "filename": filename,
            "message": "Research paper summarized successfully",
            "summary": summary,
            "images_extracted": len(extracted_images),
            "images": image_results,
            "paper_id": analysis_id,
        }

        if summary.startswith(
            "Gemini is temporarily unavailable"
        ):
            response_data["message"] = (
                "PDF uploaded successfully, but AI "
                "summarization is temporarily unavailable."
            )

        return response_data

    except HTTPException:
        raise

    except Exception as error:
        print("ERROR:", repr(error))

        # Do not leak internal exception details to the browser.
        raise HTTPException(
            status_code=500,
            detail="Unable to analyze the PDF.",
        )

    finally:
        # The original PDF is not needed after text/image extraction.
        # Keep extracted images and the RAG cache.
        cleanup_original_pdf(
            analysis_dir /
            sanitize_filename(file.filename)
        )


# =========================
# PAPER CHAT
# =========================

@app.post("/chat-with-paper")
async def chat_with_paper(
    http_request: Request,
    request: PaperChatRequest,
):
    enforce_rate_limit(
        http_request,
        "chat-with-paper",
        RATE_LIMITS["chat-with-paper"],
    )
    cleanup_rate_limit_store()

    try:
        paper_id = request.paper_id
        question = request.question.strip()

        if not question:
            raise HTTPException(
                status_code=400,
                detail="Question cannot be empty.",
            )

        if len(question) > 2000:
            raise HTTPException(
                status_code=400,
                detail="Question is too long. Keep it under 2000 characters.",
            )

        if paper_id not in paper_store:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Research paper not found. "
                    "Please upload the PDF again."
                ),
            )

        history = [
            {
                "role": message.role,
                "content": message.content.strip(),
            }
            for message in request.chat_history
            if message.role in {"user", "assistant"}
            and message.content.strip()
        ][-10:]

        paper_index = paper_index_store.get(
            paper_id
        )

        if not paper_index:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Research paper index not found. "
                    "Please upload the PDF again."
                ),
            )

        relevant_chunks = retrieve_relevant_chunks(
            paper_index,
            question,
            top_k=5,
        )

        if not relevant_chunks:
            raise HTTPException(
                status_code=404,
                detail="No relevant content was found in the paper.",
            )

        print(
            "Retrieved paper chunks:",
            len(relevant_chunks),
        )

        answer = ask_question_with_context(
            relevant_chunks,
            question,
            history,
        )

        return {
            "paper_id": paper_id,
            "question": question,
            "answer": answer,
        }

    except HTTPException:
        raise

    except Exception as error:
        print("CHAT ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Unable to answer your question.",
        )


# =========================
# IMAGE ANALYSIS
# =========================

@app.post("/analyze-image")
async def analyze_image(
    http_request: Request,
    request: ImageAnalysisRequest,
):
    enforce_rate_limit(
        http_request,
        "analyze-image",
        RATE_LIMITS["analyze-image"],
    )
    cleanup_rate_limit_store()

    try:
        requested_path = request.image_path.strip()

        if not requested_path:
            raise HTTPException(
                status_code=400,
                detail="Image path is required.",
            )

        # Accept Windows or URL separators.
        normalized = requested_path.replace("\\", "/")

        relative_path = Path(
            normalized
        )

        # Remove an accidental leading slash.
        relative_path = Path(
            str(relative_path).lstrip("/")
        )

        image_path = (
            BASE_DIR / relative_path
        ).resolve()

        if not is_safe_upload_path(image_path):
            raise HTTPException(
                status_code=400,
                detail="Invalid image path.",
            )

        if not image_path.is_file():
            raise HTTPException(
                status_code=404,
                detail="Image file not found.",
            )

        if image_path.suffix.lower() not in {
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
        }:
            raise HTTPException(
                status_code=400,
                detail="Unsupported image type.",
            )

        explanation = explain_image(
            str(image_path)
        )

        return {
            "image_path": requested_path,
            "explanation": explanation,
        }

    except HTTPException:
        raise

    except Exception as error:
        print(
            "IMAGE ANALYSIS ERROR:",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail="Unable to analyze this image.",
        )
