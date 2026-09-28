import os
import base64
import mimetypes

from dotenv import load_dotenv
from groq import Groq


load_dotenv()

api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise ValueError("GROQ_API_KEY is missing from the .env file")

client = Groq(api_key=api_key)


def encode_image(image_path: str):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def explain_image(image_path: str):
    base64_image = encode_image(image_path)

    mime_type, _ = mimetypes.guess_type(image_path)

    if mime_type is None:
        mime_type = "image/png"

    response = client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """
Analyze this figure from a research paper.

Explain:
1. What is shown in the figure?
2. What is the purpose of this figure?
3. Explain the important components in simple language.
4. If it is a flowchart, explain the process step by step.
5. If it is a graph or chart, explain its main trend.

Do not invent information that is not visible.
""",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": (
                                f"data:{mime_type};base64,"
                                f"{base64_image}"
                            )
                        },
                    },
                ],
            }
        ],
        temperature=0.7,
        max_completion_tokens=800,
    )

    return response.choices[0].message.content