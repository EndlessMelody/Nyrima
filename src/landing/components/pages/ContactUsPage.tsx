import { useState, useEffect } from "react";
import { Column, Row, Text, Button } from "@once-ui-system/core/components";
import { Github, Copy, Check, Terminal, Info, Mail, AlertTriangle } from "lucide-react";

export function ContactUsPage() {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [steps, setSteps] = useState("");
  const [category, setCategory] = useState("playback");
  const [accessMode, setAccessMode] = useState("oauth");
  const [detectedOs, setDetectedOs] = useState("Unknown OS");
  const [detectedBrowser, setDetectedBrowser] = useState("Unknown Browser");
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // Detect OS
    const ua = window.navigator.userAgent;
    let os = "Unknown OS";
    if (ua.indexOf("Windows") !== -1) os = "Windows";
    else if (ua.indexOf("Macintosh") !== -1) os = "macOS";
    else if (ua.indexOf("Linux") !== -1) os = "Linux";
    setDetectedOs(os);

    // Detect Chrome version
    const match = ua.match(/Chrom(e|ium)\/([0-9]+)\./);
    const browser = match ? `Chrome v${match[2]}` : "Chromium-based Browser";
    setDetectedBrowser(browser);
  }, []);

  const generateMarkdown = () => {
    return `### Nyrima Issue Report
**Category**: ${category.toUpperCase()}
**OS**: ${detectedOs}
**Browser**: ${detectedBrowser}
**Access Mode**: ${accessMode === "oauth" ? "BYOK OAuth Client" : "Google Drive API Key"}

#### Description
${desc || "No description provided."}

#### Steps to Reproduce
${steps || "No reproduction steps provided."}

---
*Report generated via Nyrima Promo Site.*`;
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(generateMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenGithub = () => {
    const bodyText = encodeURIComponent(generateMarkdown());
    const titleText = encodeURIComponent(`[${category.toUpperCase()}] ${title || "Issue description"}`);
    const githubUrl = `https://github.com/EndlessMelody/Nyrima/issues/new?title=${titleText}&body=${bodyText}`;
    window.open(githubUrl, "_blank");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 4000);
  };

  return (
    <Column className="ny-page-container fade-in">
      <Row className="ny-page-header-row" horizontal="between" vertical="center" gap="20">
        <Column gap="4">
          <Text className="section-kicker" variant="body-strong-xs">
            GET IN TOUCH
          </Text>
          <Text variant="heading-strong-l" className="ny-page-title">
            Contact & Issue Report
          </Text>
        </Column>

        <Row gap="8" className="ny-sub-badge">
          <Github size={14} className="ny-cyan-text" />
          <Text variant="body-strong-xs">Open Source Community</Text>
        </Row>
      </Row>

      <Row className="ny-page-split-layout" gap="24">
        {/* Left Side: Form */}
        <Column className="ny-contact-form-panel" gap="16" style={{ flex: "1", minWidth: 0 }}>
          <Text variant="body-strong-m" className="ny-panel-subtitle">
            Issue Details
          </Text>

          <div className="ny-scroll-box" style={{ flex: 1, overflowY: "auto", paddingRight: 8 }}>
            <Column gap="12">
              <Column gap="4">
                <label className="ny-input-label">Report Category</label>
                <select
                  className="ny-form-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="playback">Playback / Codecs / Subtitles</option>
                  <option value="oauth">OAuth / Login Issues</option>
                  <option value="listing">Drive Listing / Indexing</option>
                  <option value="sharing">Sharing / Imports</option>
                  <option value="other">Other Bug / Suggestion</option>
                </select>
              </Column>

              <Column gap="4">
                <label className="ny-input-label">Issue Title</label>
                <input
                  type="text"
                  className="ny-form-input"
                  placeholder="e.g. Subtitles fail to render on seek"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Column>

              <Column gap="4">
                <label className="ny-input-label">Access Configuration</label>
                <Row gap="12">
                  <label className="ny-radio-label">
                    <input
                      type="radio"
                      name="accessMode"
                      value="oauth"
                      checked={accessMode === "oauth"}
                      onChange={() => setAccessMode("oauth")}
                    />
                    <span>BYOK OAuth</span>
                  </label>
                  <label className="ny-radio-label">
                    <input
                      type="radio"
                      name="accessMode"
                      value="key"
                      checked={accessMode === "key"}
                      onChange={() => setAccessMode("key")}
                    />
                    <span>API Key</span>
                  </label>
                </Row>
              </Column>

              <Column gap="4">
                <label className="ny-input-label">Describe the Issue</label>
                <textarea
                  rows={3}
                  className="ny-form-textarea"
                  placeholder="What is failing? Note exact error message..."
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </Column>

              <Column gap="4">
                <label className="ny-input-label">Steps to Reproduce</label>
                <textarea
                  rows={2}
                  className="ny-form-textarea"
                  placeholder="1. Open Drive folder...&#10;2. Click play on MKV file..."
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                />
              </Column>
            </Column>
          </div>
        </Column>

        {/* Right Side: Markdown Preview / Actions */}
        <Column className="ny-contact-preview-panel" gap="16" style={{ flex: "1.1", minWidth: 0 }}>
          <Text variant="body-strong-m" className="ny-panel-subtitle">
            Markdown Template
          </Text>

          <Column className="ny-markdown-card-container" style={{ flex: 1, minHeight: 0 }}>
            <div className="ny-markdown-preview-header">
              <Row gap="8" vertical="center">
                <Terminal size={14} className="ny-cyan-text" />
                <span className="ny-preview-tag">github-template.md</span>
              </Row>
              <button className="ny-copy-btn-small" onClick={handleCopyMarkdown}>
                {copied ? <Check size={14} className="ny-mint-text" /> : <Copy size={14} />}
                <span>{copied ? "Copied!" : "Copy template"}</span>
              </button>
            </div>
            
            <pre className="ny-markdown-preview-body">
              {generateMarkdown()}
            </pre>
          </Column>

          <Column gap="8" className="ny-contact-footer">
            <Row gap="8" vertical="start" className="ny-help-box">
              <Info size={16} className="ny-cyan-text" style={{ marginTop: 2 }} />
              <p className="ny-help-text">
                Nyrima does not collect your data. This tool pre-fills a GitHub issue template. Press the button below to publish it in the open issue tracker.
              </p>
            </Row>

            <Row gap="8">
              <button className="ny-submit-btn" onClick={handleOpenGithub}>
                <Github size={16} />
                <span>Submit to GitHub</span>
              </button>
            </Row>

            {submitted && (
              <div className="ny-submitted-toast fade-in">
                <Check size={14} />
                <span>GitHub tab opened! Thank you for reporting!</span>
              </div>
            )}
          </Column>
        </Column>
      </Row>
    </Column>
  );
}
