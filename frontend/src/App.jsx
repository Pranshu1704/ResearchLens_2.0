import { useState, useRef, useCallback, useEffect } from "react";
import jsPDF from "jspdf";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";

  const sizes = ["Bytes", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${parseFloat(
    (bytes / Math.pow(1024, index)).toFixed(2)
  )} ${sizes[index]}`;
}

function normalizeImageUrl(imageUrl) {
  if (!imageUrl) return "";

  if (imageUrl.startsWith("http")) {
    return imageUrl;
  }

  return `${API_BASE_URL}/${imageUrl.replace(/^\/+/, "")}`;
}

function downloadSummary(result, fileName) {
  if (!result?.summary) {
    console.log("No summary available");
    return;
  }

  try {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const summary = result.summary;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const checkPage = (height = 8) => {
      if (y + height > pageHeight - 18) {
        doc.addPage();
        y = 20;
      }
    };

    const cleanText = (value) => {
      if (value === null || value === undefined) return "";

      if (typeof value === "object") {
        return JSON.stringify(value, null, 2);
      }

      return String(value)
        .replace(/\r/g, "")
        .replace(/\\n/g, "\n")
        .trim();
    };

    const addHeading = (text, size = 15) => {
      checkPage(15);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.setTextColor(35, 50, 80);
      doc.text(cleanText(text), margin, y);

      y += 7;

      doc.setDrawColor(220, 220, 220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 7;
    };

    const addParagraph = (text) => {
      const cleaned = cleanText(text);
      if (!cleaned) return;

      const lines = doc.splitTextToSize(cleaned, contentWidth);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(55, 55, 55);

      lines.forEach((line) => {
        checkPage(6);
        doc.text(line, margin, y);
        y += 5.5;
      });

      y += 3;
    };

    const addBullet = (text) => {
      const cleaned = cleanText(text);
      if (!cleaned) return;

      const lines = doc.splitTextToSize(cleaned, contentWidth - 7);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(55, 55, 55);

      lines.forEach((line, index) => {
        checkPage(6);

        if (index === 0) {
          doc.text("•", margin, y);
        }

        doc.text(line, margin + 5, y);
        y += 5.5;
      });

      y += 2;
    };

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(50, 70, 150);
    doc.text("ResearchLens", margin, y);

    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(100, 100, 100);
    doc.text(
      "AI-Powered Research Paper Analysis Report",
      margin,
      y
    );

    y += 6;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;

    // Summary
    if (typeof summary === "string") {
      addHeading("Research Summary");
      addParagraph(summary);
    } else {
      Object.entries(summary).forEach(([key, value]) => {
        if (key?.toLowerCase() === "images") return;

        const heading = key
          .replace(/_/g, " ")
          .replace(/-/g, " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase());

        addHeading(heading);

        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (typeof item === "object" && item !== null) {
              Object.entries(item).forEach(([subKey, subValue]) => {
                const subHeading = subKey
                  .replace(/_/g, " ")
                  .replace(/-/g, " ")
                  .replace(/\b\w/g, (letter) => letter.toUpperCase());

                checkPage(10);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(10.5);
                doc.setTextColor(65, 65, 65);
                doc.text(`${subHeading}:`, margin, y);
                y += 6;
                addParagraph(subValue);
              });
            } else {
              addBullet(item);
            }
          });
        } else if (typeof value === "object" && value !== null) {
          Object.entries(value).forEach(([subKey, subValue]) => {
            const subHeading = subKey
              .replace(/_/g, " ")
              .replace(/-/g, " ")
              .replace(/\b\w/g, (letter) => letter.toUpperCase());

            checkPage(10);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10.5);
            doc.setTextColor(65, 65, 65);
            doc.text(`${subHeading}:`, margin, y);
            y += 6;
            addParagraph(subValue);
          });
        } else {
          addParagraph(value);
        }

        y += 3;
      });
    }

    // Page numbers
    const totalPages = doc.internal.getNumberOfPages();

    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 130);

      doc.text(
        "Generated by ResearchLens",
        margin,
        pageHeight - 10
      );

      doc.text(
        `Page ${page} of ${totalPages}`,
        pageWidth - margin,
        pageHeight - 10,
        { align: "right" }
      );
    }

    let safeFileName = fileName || "research-summary";

    safeFileName = safeFileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[<>:"/\\|?*]+/g, "_")
      .trim();

    if (!safeFileName) {
      safeFileName = "research-summary";
    }

    doc.save(`${safeFileName}.pdf`);
  } catch (error) {
    console.error("PDF generation failed:", error);
    alert("Unable to generate PDF. Please check the browser console.");
  }
}

function formatSectionTitle(title) {
  return title
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanMarkdownText(text) {
  return String(text)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMarkdownSummary(summary) {
  if (!summary || typeof summary !== "string") {
    return [];
  }

  const text = String(summary)
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Supports:
  // 1. Section Title - content
  // --- 2. Section Title - content
  // ### 2. Section Title - content
  const headingRegex =
    /(?:^|\s)(?:#{1,6}\s*)?(?:---\s*)?(\d+)\.\s+([^-\d]+?)\s+-\s+/g;

  const matches = [...text.matchAll(headingRegex)];

  if (matches.length === 0) {
    return [
      {
        number: "1",
        title: "Research Paper Summary",
        points: [cleanMarkdownText(text)],
      },
    ];
  }

  const sections = [];

  matches.forEach((match, index) => {
    const number = match[1];
    const title = cleanMarkdownText(match[2]);

    const contentStart = match.index + match[0].length;
    const contentEnd =
      index + 1 < matches.length
        ? matches[index + 1].index
        : text.length;

    const content = text
      .slice(contentStart, contentEnd)
      .replace(/^\s*[-–—:]+\s*/, "")
      .replace(/\s*---\s*$/, "")
      .trim();

    const points = content
      .split(/\s+-\s+(?=[A-Z0-9])/)
      .map((point) => cleanMarkdownText(point))
      .filter(Boolean);

    sections.push({
      number,
      title,
      points,
    });
  });

  return sections;
}

function MarkdownSummary({ summary }) {
  const sections = parseMarkdownSummary(summary);

  return (
    <div className="summary-list-wrapper">
      {sections.map((section, index) => (
        <SummarySection
          key={index}
          number={section.number || index + 1}
          title={section.title}
          points={section.points}
        />
      ))}
    </div>
  );
}

function SummarySection({ title, value, index, number, points }) {
  let renderedPoints = points;

  if (!renderedPoints) {
    if (Array.isArray(value)) {
      renderedPoints = value.map((item) =>
        typeof item === "object" ? JSON.stringify(item) : String(item)
      );
    } else if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      typeof value !== "object"
    ) {
      renderedPoints = [String(value)];
    } else if (value && typeof value === "object") {
      renderedPoints = [JSON.stringify(value, null, 2)];
    } else {
      renderedPoints = [];
    }
  }

  if (
    renderedPoints.length === 0 ||
    title === "images" ||
    title?.toLowerCase() === "images"
  ) {
    return null;
  }

  return (
    <section className="summary-section">
      <div className="section-number">
        {number || index + 1}
      </div>

      <div className="section-content">
        <h3>{formatSectionTitle(title)}</h3>

        <ul className="summary-list">
          {renderedPoints.map((point, pointIndex) => (
            <li key={pointIndex}>
              <span className="summary-bullet"></span>
              <span>{cleanMarkdownText(point)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FigureExplanation({ text }) {
  const cleanedText = String(text)
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Detect EVERY numbered item dynamically.
  // It works whether Gemini returns 5, 11, or 20 items.
  const itemRegex =
    /(?:^|\s)(\d+)\.\s+(.+?)(?=(?:\s+\d+\.\s+)|$)/g;

  const matches = [...cleanedText.matchAll(itemRegex)];

  if (matches.length === 0) {
    return (
      <div className="figure-explanation-content">
        <p className="explanation-intro">{cleanedText}</p>
      </div>
    );
  }

  const intro = cleanedText
    .slice(0, matches[0].index)
    .trim();

  return (
    <div className="figure-explanation-content">
      {intro && (
        <p className="explanation-intro">{intro}</p>
      )}

      {matches.map((match, index) => {
        const number = match[1];
        const fullItem = match[2].trim();

        let question = fullItem;
        let answer = "";

        // Most Gemini responses use a question mark.
        const questionMark = fullItem.indexOf("?");

        if (questionMark !== -1) {
          question = fullItem.slice(0, questionMark + 1).trim();
          answer = fullItem.slice(questionMark + 1).trim();
        } else {
          // Some responses use a period instead of a question mark.
          const sentenceEnd = fullItem.search(/\.\s+(?=[A-Z])/);

          if (sentenceEnd !== -1) {
            question = fullItem.slice(0, sentenceEnd + 1).trim();
            answer = fullItem.slice(sentenceEnd + 1).trim();
          }
        }

        return (
          <div
            className="explanation-section"
            key={`${number}-${index}`}
          >
            <h4>
              {number}. {question}
            </h4>

            {answer && <p>{answer}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FigureCard({ image, index }) {
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [showExplanation, setShowExplanation] = useState(false);

  const imageUrl = getImageSource(image);
  const imagePath = image.image_path || image.path;

  const analyzeFigure = async () => {
    if (!imagePath) {
      setError("Image path is missing.");
      return;
    }

    if (explanation) {
      setShowExplanation((previous) => !previous);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/analyze-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_path: imagePath,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to analyze image.");
      }

      setExplanation(data.explanation || "No explanation returned.");
      setShowExplanation(true);
    } catch (err) {
      setError(err.message || "Unable to analyze this figure.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="figure-card">
      <div className="figure-header">
        <div>
          <span className="figure-label">
            FIGURE {String(index + 1).padStart(2, "0")}
          </span>
          <h3>Extracted Research Figure</h3>
        </div>

        <span className="figure-status">IMAGE</span>
      </div>

      <div className="figure-image-wrapper">
        <img
          src={imageUrl}
          alt={`Extracted figure ${index + 1}`}
          className="figure-image"
        />
      </div>

      <button
        className={`figure-analyze-button ${
          showExplanation ? "figure-analyze-button-open" : ""
        }`}
        onClick={analyzeFigure}
        disabled={loading}
        aria-expanded={showExplanation}
      >
        {loading ? (
          <>
            <span className="button-spinner"></span>
            Analyzing figure...
          </>
        ) : showExplanation ? (
          <>
            <span className="explanation-arrow">↑</span>
            Hide Explanation
          </>
        ) : (
          <>
            <span>✦</span>
            Explain This Figure
          </>
        )}
      </button>

      {error && <p className="figure-error">{error}</p>}

      {explanation && showExplanation && (
        <div className="figure-explanation">
          <div className="explanation-heading">
            <span>✦</span>
            AI Figure Explanation
          </div>
          <FigureExplanation text={explanation} />
        </div>
      )}
    </article>
  );
}


function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4" stroke="white" strokeWidth="1.5" />
      <line
        x1="9.5"
        y1="9.5"
        x2="14"
        y2="14"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UploadIcon({ selected = false }) {
  return selected ? (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="#22d3ee"
        strokeWidth="1.5"
      />
      <polyline
        points="14,2 14,8 20,8"
        stroke="#22d3ee"
        strokeWidth="1.5"
      />
      <line
        x1="9"
        y1="13"
        x2="15"
        y2="13"
        stroke="#22d3ee"
        strokeWidth="1.5"
      />
      <line
        x1="9"
        y1="17"
        x2="13"
        y2="17"
        stroke="#22d3ee"
        strokeWidth="1.5"
      />
    </svg>
  ) : (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        stroke="#4f6ef7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polyline
        points="17,8 12,3 7,8"
        stroke="#4f6ef7"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="12"
        y1="3"
        x2="12"
        y2="15"
        stroke="#4f6ef7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 8l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 1v8M4 6l3 3 3-3M1 11h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getImageSource(image) {
  return normalizeImageUrl(
    image?.image_url || image?.url || image?.path || ""
  );
}

function getImageFallbackIdentity(image) {
  const value =
    image?.image_path ||
    image?.image_url ||
    image?.url ||
    image?.path ||
    "";

  return String(value)
    .replace(/\\/g, "/")
    .split("?")[0]
    .split("#")[0]
    .trim()
    .toLowerCase();
}

async function getImageFingerprint(image) {
  const source = getImageSource(image);

  if (!source) {
    return null;
  }

  try {
    const response = await fetch(source, {
      cache: "force-cache",
    });

    if (!response.ok) {
      return null;
    }

    const buffer = await response.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function removeDuplicateImages(images) {
  const seen = new Set();
  const uniqueImages = [];

  for (const image of images) {
    const fingerprint = await getImageFingerprint(image);
    const fallbackIdentity = getImageFallbackIdentity(image);
    const identity = fingerprint || fallbackIdentity;

    if (!identity || seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    uniqueImages.push(image);
  }

  return uniqueImages;
}

export default function App() {
  const [state, setState] = useState("idle");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [extractedImages, setExtractedImages] = useState([]);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  // Paper chat state
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");

  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const images = result?.images || [];

    if (!images.length) {
      setExtractedImages([]);
      return undefined;
    }

    setExtractedImages([]);

    removeDuplicateImages(images).then((uniqueImages) => {
      if (!cancelled) {
        setExtractedImages(uniqueImages);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [result?.images]);

  const handleFile = (selectedFile) => {
    if (!selectedFile) return;

    const isPDF =
      selectedFile.type === "application/pdf" ||
      selectedFile.name.toLowerCase().endsWith(".pdf");

    if (!isPDF) {
      setError("Only PDF files are allowed.");
      setFile(null);
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) {
      setError("File size must be less than 50 MB.");
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setResult(null);
    setExtractedImages([]);
    setChatQuestion("");
    setChatMessages([]);
    setChatError("");
    setChatLoading(false);
    setError("");
    setState("idle");
    setProgress(0);
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (selectedFile) {
      handleFile(selectedFile);
    }
  };

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setDragging(false);

    const droppedFile = event.dataTransfer.files?.[0];

    if (droppedFile) {
      handleFile(droppedFile);
    }
  }, []);

  const handleDragOver = (event) => {
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setDragging(false);
  };

  const analyzePDF = async () => {
    if (!file) return;

    setState("analyzing");
    setProgress(10);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    let progressTimer;

    try {
      progressTimer = setInterval(() => {
        setProgress((previousProgress) => {
          if (previousProgress >= 90) {
            return previousProgress;
          }

          return Math.min(previousProgress + 2, 90);
        });
      }, 700);

      const response = await fetch(`${API_BASE_URL}/summarize-pdf`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Something went wrong while analyzing the PDF."
        );
      }

      if (!data) {
        throw new Error("Backend returned an empty response.");
      }

      console.log("ResearchLens API response:", data);

      setProgress(100);
      setResult(data);
      setState("done");

      console.log("ResearchLens: Result page activated");
    } catch (err) {
      console.error("ResearchLens analysis error:", err);
      setError(err.message || "Unable to analyze the PDF.");
      setState("idle");
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }
    }
  };

  const suggestedQuestions = [
    "What is the main problem addressed by this paper?",
    "What methodology did the authors use?",
    "What are the key findings of this paper?",
    "What limitations are mentioned in the paper?",
  ];

  const askPaperQuestion = async (questionOverride = null) => {
    const question = (questionOverride ?? chatQuestion).trim();

    if (!question || chatLoading) {
      return;
    }

    if (!result?.paper_id) {
      setChatError(
        "Paper context is unavailable. Please analyze the PDF again."
      );
      return;
    }

    // Send only real conversation messages to the backend.
    // Keep the current question separate because it is not an assistant reply yet.
    const chatHistory = chatMessages
      .filter(
        (message) =>
          message.role === "user" ||
          message.role === "assistant"
      )
      .slice(-10)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const userMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: question,
    };

    setChatMessages((previous) => [...previous, userMessage]);
    setChatQuestion("");
    setChatError("");
    setChatLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/chat-with-paper`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paper_id: result.paper_id,
            question: question,
            chat_history: chatHistory,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Unable to answer the question."
        );
      }

      const answer = data.answer || "No answer returned.";

      setChatMessages((previous) => [
        ...previous,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: answer,
        },
      ]);
    } catch (err) {
      const message =
        err.message ||
        "Unable to connect to ResearchLens AI.";

      setChatError(message);

      setChatMessages((previous) => [
        ...previous,
        {
          id: `${Date.now()}-assistant-error`,
          role: "assistant",
          content: `I couldn't answer that right now. ${message}`,
          isError: true,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askPaperQuestion();
    }
  };

  const clearChat = () => {
    setChatMessages([]);
    setChatQuestion("");
    setChatError("");
  };

  const resetApp = () => {
    setState("idle");
    setFile(null);
    setResult(null);
    setExtractedImages([]);
    setChatQuestion("");
    setChatMessages([]);
    setChatError("");
    setChatLoading(false);
    setProgress(0);
    setError("");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const summaryEntries =
    result?.summary && typeof result.summary === "object"
      ? Object.entries(result.summary)
      : [];

  const visibleSummaryEntries = summaryEntries.filter(
    ([title, value]) =>
      title?.toLowerCase() !== "images" &&
      value !== null &&
      value !== undefined &&
      value !== ""
  );

  return (
    <div className="researchlens-app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon">
              <SearchIcon />
            </div>
            <span className="brand-name">ResearchLens</span>
          </div>

          <span className="brand-subtitle">
            AI-powered research paper analysis
          </span>
        </div>
      </header>

      <main className="page-container">
        {state !== "done" && (
          <section className="hero">
            <div className="hero-badge">
              <span className="hero-dot"></span>
              BETA · RESEARCH INTELLIGENCE
            </div>

            <h1 className="hero-title">
              Analyze any research paper
              <br />
              <em>in seconds.</em>
            </h1>

            <p className="hero-description">
              Upload a PDF and let our AI extract structure, objectives,
              methodology, findings, and more — instantly.
            </p>
          </section>
        )}

        {state !== "done" && (
          <section
            className={`upload-card ${dragging ? "upload-card-dragging" : ""}`}
          >
            {state === "idle" && (
              <>
                <div
                  className={`drop-zone ${dragging ? "drop-zone-active" : ""} ${
                    file ? "drop-zone-file" : ""
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden-input"
                    onChange={handleFileChange}
                  />

                  {file ? (
                    <>
                      <div className="upload-icon selected">
                        <UploadIcon selected />
                      </div>

                      <div className="selected-file-text">
                        <p className="selected-file-name">{file.name}</p>
                        <p className="selected-file-meta">
                          {formatFileSize(file.size)} · Click to change
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="upload-icon">
                        <UploadIcon />
                      </div>

                      <div className="drop-copy">
                        <p className="drop-title">
                          Drag &amp; drop your research paper
                        </p>
                        <p className="drop-subtitle">
                          or{" "}
                          <span className="browse-text">
                            browse PDF from your computer
                          </span>
                        </p>
                      </div>

                      <p className="file-limit">PDF · max 50 MB</p>
                    </>
                  )}
                </div>

                {error && <p className="error-message">{error}</p>}

                <div className="upload-actions">
                  <button
                    className="analyze-button"
                    onClick={analyzePDF}
                    disabled={!file}
                  >
                    <CheckIcon />
                    Analyze PDF
                  </button>
                </div>
              </>
            )}

            {state === "analyzing" && (
              <div className="analyzing-state">
                <div className="progress-ring">
                  <svg
                    className="progress-ring-svg"
                    viewBox="0 0 64 64"
                    aria-hidden="true"
                  >
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="#1e2d4a"
                      strokeWidth="3"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="url(#researchlens-progress)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 28}
                      strokeDashoffset={
                        2 *
                        Math.PI *
                        28 *
                        (1 - Math.min(progress, 100) / 100)
                      }
                    />
                    <defs>
                      <linearGradient
                        id="researchlens-progress"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#4f6ef7" />
                        <stop offset="100%" stopColor="#22d3ee" />
                      </linearGradient>
                    </defs>
                  </svg>

                  <span className="progress-number">
                    {Math.min(Math.round(progress), 100)}%
                  </span>
                </div>

                <div className="analyzing-copy">
                  <h3>Analyzing your paper...</h3>
                  <p>
                    Extracting structure, objectives, and findings
                  </p>
                </div>

                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(progress, 100)}%`,
                    }}
                  ></div>
                </div>
              </div>
            )}
          </section>
        )}

        {state !== "done" && (
          <div className="home-footer">
            <span>PDF ANALYSIS · AI-POWERED</span>
            <span>ResearchLens v1.0</span>
          </div>
        )}

        {state === "done" && result && (
          <section className="results-card">
            <div className="results-header">
              <div className="results-heading">
                <h1>Research Analysis</h1>
                <div className="results-meta">
                  <span className="success-text">
                    ✓ Paper summarized successfully
                  </span>
                  <span className="meta-dot">·</span>
                  <span>{file?.name}</span>
                </div>
              </div>

              <div className="results-actions">
                <button
                  className="download-button"
                  onClick={() =>
                    downloadSummary(
                      result,
                      file?.name?.replace(/\.pdf$/i, "")
                    )
                  }
                >
                  <DownloadIcon />
                  Download Summary
                </button>

                <button
                  className="new-analysis-button"
                  onClick={resetApp}
                >
                  New Analysis
                </button>
              </div>
            </div>

            <div className="summary-wrapper">
              {typeof result.summary === "string" ? (
                <MarkdownSummary summary={result.summary} />
              ) : (
                <div className="summary-list-wrapper">
                  {summaryEntries.map(([title, value], index) => (
                    <SummarySection
                      key={`${title}-${index}`}
                      title={title}
                      value={value}
                      index={index}
                    />
                  ))}
                </div>
              )}
            </div>
            <section className="paper-chat-section">
              <div className="paper-chat-header">
                <div>
                  <div className="results-eyebrow">
                    PAPER INTELLIGENCE
                  </div>

                  <div className="paper-chat-title-row">
                    <h2>Chat with This Paper</h2>
                    <span className="paper-chat-status">
                      ● AI READY
                    </span>
                  </div>

                  <p>
                    Ask questions about the research paper and continue the
                    conversation using answers grounded in its content.
                  </p>
                </div>

                {chatMessages.length > 0 && (
                  <button
                    type="button"
                    className="paper-chat-clear"
                    onClick={clearChat}
                    disabled={chatLoading}
                  >
                    Clear Chat
                  </button>
                )}
              </div>

              {chatMessages.length === 0 && (
                <div className="paper-chat-suggestions">
                  <span>Try asking</span>

                  <div className="paper-chat-suggestion-list">
                    {suggestedQuestions.map((question) => (
                      <button
                        key={question}
                        type="button"
                        className="paper-chat-suggestion"
                        onClick={() => {
                          setChatQuestion(question);
                          setChatError("");
                        }}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.length > 0 && (
                <div className="paper-chat-messages">
                  {chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`paper-chat-message ${
                        message.role === "user"
                          ? "paper-chat-message-user"
                          : "paper-chat-message-ai"
                      } ${message.isError ? "paper-chat-message-error" : ""}`}
                    >
                      <div className="paper-chat-message-label">
                        {message.role === "user"
                          ? "You"
                          : "ResearchLens AI"}
                      </div>
                      <p>{message.content}</p>
                    </div>
                  ))}

                  {chatLoading && (
                    <div className="paper-chat-message paper-chat-message-ai">
                      <div className="paper-chat-message-label">
                        ResearchLens AI
                      </div>
                      <div className="paper-chat-thinking">
                        <span></span>
                        <span></span>
                        <span></span>
                        <em>Thinking...</em>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {chatError && chatMessages.length === 0 && (
                <div className="paper-chat-error">
                  {chatError}
                </div>
              )}

              <div className="paper-chat-input-row">
                <textarea
                  className="paper-chat-input"
                  value={chatQuestion}
                  onChange={(event) => {
                    setChatQuestion(event.target.value);
                    setChatError("");
                  }}
                  onKeyDown={handleChatKeyDown}
                  placeholder="Ask something about this research paper..."
                  rows={3}
                  disabled={chatLoading}
                />

                <div className="paper-chat-input-footer">
                  <span>Enter to send · Shift + Enter for a new line</span>

                  <button
                    type="button"
                    className="paper-chat-button"
                    onClick={() => askPaperQuestion()}
                    disabled={
                      chatLoading ||
                      !chatQuestion.trim()
                    }
                  >
                    {chatLoading ? "Thinking..." : "Ask ResearchLens"}
                    <span>→</span>
                  </button>
                </div>
              </div>
            </section>
            {extractedImages.length > 0 && (
              <section className="figures-section">
                <div className="figures-heading">
                  <div>
                    <div className="results-eyebrow">
                      VISUAL INTELLIGENCE
                    </div>
                    <h2>Extracted Figures</h2>
                  </div>

                  <span className="figure-count">
                    {extractedImages.length} FIGURES
                  </span>
                </div>

                <p className="figures-description">
                  Explore diagrams, charts, and figures extracted from your
                  research paper. Ask AI to explain any figure.
                </p>

                <div className="figures-grid">
                  {extractedImages.map((image, index) => (
                    <FigureCard
                      key={`${image.image_path || image.image_url}-${index}`}
                      image={image}
                      index={index}
                    />
                  ))}
                </div>
              </section>
            )}

            <div className="results-footer">
              <span>
                {typeof result.summary === "string"
                  ? parseMarkdownSummary(result.summary).length
                  : visibleSummaryEntries.length}{" "}
                SECTIONS · AI-GENERATED SUMMARY
              </span>
              <span>ResearchLens v1.0</span>
            </div>
          </section>
        )}

        {error && state === "idle" && !file && (
          <p className="error-message bottom-error">{error}</p>
        )}
      </main>
    </div>
  );
}
