from pathlib import Path
import shutil
import time

BASE_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BASE_DIR / "uploads"
RAG_CACHE_DIR = BASE_DIR / "rag_cache"

UPLOAD_RETENTION_HOURS = 24
RAG_CACHE_RETENTION_DAYS = 30


def cleanup():
    upload_cutoff = time.time() - (
        UPLOAD_RETENTION_HOURS * 60 * 60
    )
    cache_cutoff = time.time() - (
        RAG_CACHE_RETENTION_DAYS * 24 * 60 * 60
    )

    removed_upload_dirs = 0
    removed_cache_files = 0

    if UPLOADS_DIR.exists():
        for path in UPLOADS_DIR.iterdir():
            if path.is_dir() and path.stat().st_mtime < upload_cutoff:
                shutil.rmtree(path, ignore_errors=True)
                removed_upload_dirs += 1

    if RAG_CACHE_DIR.exists():
        for path in RAG_CACHE_DIR.iterdir():
            if path.is_file() and path.stat().st_mtime < cache_cutoff:
                try:
                    path.unlink()
                    removed_cache_files += 1
                except OSError:
                    pass

    print(f"Removed upload directories: {removed_upload_dirs}")
    print(f"Removed RAG cache files: {removed_cache_files}")


if __name__ == "__main__":
    cleanup()
