import { useEffect, useRef } from "react";
import { X, Mail, Github } from "lucide-react";

const DEVELOPER_NAME = import.meta.env.VITE_DEVELOPER_NAME || "Khoa Phan";
const DEVELOPER_EMAIL = import.meta.env.VITE_DEVELOPER_EMAIL || "pldkhoa.work@gmail.com";
const NYRIMA_REPO_URL = import.meta.env.VITE_NYRIMA_REPO_URL || "https://github.com/EndlessMelody/Nyrima";

interface ContactPanelProps {
  onClose: () => void;
}

export function ContactPanel({ onClose }: ContactPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the close button on mount for accessibility
    const closeBtn = panelRef.current?.querySelector("button");
    closeBtn?.focus();

    // Close on click outside
    const handleOutsideClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Close on Escape key press
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="lvn-contact-backdrop">
      <div
        className="lvn-contact-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-title"
      >
        <button
          className="lvn-contact-close"
          onClick={onClose}
          aria-label="Close contact info"
        >
          <X size={16} />
        </button>

        <h2 id="contact-title" className="lvn-contact-title">
          Developer
        </h2>

        <div className="lvn-contact-body">
          <p className="lvn-contact-desc">
            Nyrima is a personal visual-novel-inspired anime library project, built to create a better private anime viewing experience.
          </p>

          <div className="lvn-contact-item">
            <span className="lvn-contact-label">Developer:</span>
            <span className="lvn-contact-value">{DEVELOPER_NAME}</span>
          </div>

          <div className="lvn-contact-item">
            <span className="lvn-contact-label">Contact:</span>
            <a
              href={`mailto:${DEVELOPER_EMAIL}`}
              className="lvn-contact-link"
              aria-label={`Email developer at ${DEVELOPER_EMAIL}`}
            >
              <Mail size={13} aria-hidden="true" />
              <span>{DEVELOPER_EMAIL}</span>
            </a>
          </div>

          <div className="lvn-contact-item">
            <span className="lvn-contact-label">Repository:</span>
            <a
              href={NYRIMA_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lvn-contact-link"
              aria-label="Visit Nyrima GitHub repository"
            >
              <Github size={13} aria-hidden="true" />
              <span>GitHub Repository</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
