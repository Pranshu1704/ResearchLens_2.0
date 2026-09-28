import os

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise ValueError("GROQ_API_KEY is missing from the .env file")

client = Groq(api_key=api_key)

MODEL_NAME = "openai/gpt-oss-20b"


def summarize_research_paper(text: str) -> str:
    prompt = f"""
You are an expert research paper analyst.

Analyze the following research paper and provide a clear, structured
analysis using the exact headings below.

## 1. Research Paper Overview
Explain the paper briefly.

## 2. Problem Statement
What problem does the research address?

## 3. Research Objectives
List the main objectives of the research.

## 4. Methodology
Explain the methods, techniques, algorithms, or processes used.

## 5. Technologies or Tools Used
Mention programming languages, frameworks, datasets, or tools if available.

## 6. Key Findings
Explain the main results and discoveries.

## 7. Advantages
List the important benefits of the proposed approach.

## 8. Limitations
Mention the limitations or challenges discussed in the paper.

## 9. Future Scope
Explain possible future improvements or research directions.

## 10. Simple Explanation
Explain the entire research paper in beginner-friendly language.

Rules:
- Use simple and clear English.
- Use bullet points wherever appropriate.
- Do not invent information.
- If any information is unavailable, write "Not clearly mentioned in the paper."
- Keep the analysis informative but concise.

Research paper text:
{text[:12000]}
"""

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": "You are an expert research paper analyst."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.3,
        max_tokens=2500
    )

    return response.choices[0].message.content


def _format_chat_history(chat_history: list[dict] | None) -> str:
    history = chat_history or []
    history_text = ""

    for message in history[-10:]:
        role = message.get("role")
        content = str(message.get("content", "")).strip()

        if role not in {"user", "assistant"} or not content:
            continue

        speaker = "User" if role == "user" else "ResearchLens AI"
        history_text += f"{speaker}: {content}\n"

    return history_text or "No previous conversation."


def ask_question_with_context(
    retrieved_chunks: list[str],
    question: str,
    chat_history: list[dict] | None = None
) -> str:
    context = "\n\n--- RESEARCH PAPER CONTEXT ---\n\n".join(
        retrieved_chunks
    )

    history_text = _format_chat_history(chat_history)

    prompt = f"""
You are ResearchLens, an AI research-paper assistant.

Answer the user's latest question using ONLY the supplied research-paper
context and the previous conversation.

Relevant research-paper context:
{context}

Previous conversation:
{history_text}

Latest user question:
{question}

Rules:
- Treat the research-paper context as the source of truth.
- Use previous conversation only to resolve references such as
  "this method", "they", "it", or "that result".
- Do not invent facts or fill missing information with outside knowledge.
- If the supplied context does not contain enough information, say:
  "This information is not clearly mentioned in the paper."
- Answer the latest question directly.
- Do not repeat the full previous answer unless necessary.
- Use simple and clear English.
- Keep the answer concise but useful.
"""

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a research-paper question answering assistant. "
                    "Use only the supplied paper context and conversation "
                    "history. Never invent unsupported information."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.2,
        max_tokens=1000
    )

    return response.choices[0].message.content
