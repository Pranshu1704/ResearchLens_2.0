import fitz
import os
import io
import hashlib
from PIL import Image


def get_image_hash(image_bytes: bytes):
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image = image.convert("RGB")

        # Resize so visually same images can be compared
        image = image.resize((32, 32))

        # Raw pixel hash
        pixel_data = image.tobytes()

        return hashlib.sha256(pixel_data).hexdigest()

    except Exception:
        return hashlib.sha256(image_bytes).hexdigest()


def extract_images_from_pdf(pdf_path: str):
    extracted_images = []
    detected_hashes = set()

    pdf_document = fitz.open(pdf_path)

    image_folder = os.path.join(
        os.path.dirname(pdf_path),
        "extracted_images"
    )

    os.makedirs(image_folder, exist_ok=True)

    image_count = 0

    for page_number, page in enumerate(pdf_document):

        images = page.get_images(full=True)

        for image in images:

            xref = image[0]

            try:
                image_data = pdf_document.extract_image(xref)

                image_bytes = image_data["image"]
                image_extension = image_data["ext"]

                # Detect whether this image was already extracted
                image_hash = get_image_hash(image_bytes)

                if image_hash in detected_hashes:
                    continue

                detected_hashes.add(image_hash)

                image_count += 1

                image_filename = (
                    f"image_{image_count}.{image_extension}"
                )

                image_path = os.path.join(
                    image_folder,
                    image_filename
                )

                with open(image_path, "wb") as image_file:
                    image_file.write(image_bytes)

                extracted_images.append(image_path)

            except Exception as error:
                print(
                    f"Could not extract image from page "
                    f"{page_number + 1}: {error}"
                )

    pdf_document.close()

    return extracted_images