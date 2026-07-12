import { useState } from "react";
import { Column, Row, Text, Button } from "@once-ui-system/core/components";
import { Download, Terminal, ExternalLink, Play, Sparkles, Music, Chrome, Github, AlertTriangle } from "lucide-react";
import { buildZipUrl, repoUrl } from "../sections/sectionData";

export function DownloadPage() {
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  return (
    <Column className="ny-page-container fade-in">
      <Row className="ny-page-header-row" horizontal="between" vertical="center" gap="20">
        <Column gap="4">
          <Text className="section-kicker" variant="body-strong-xs">
            GETTING STARTED
          </Text>
          <Text variant="heading-strong-l" className="ny-page-title">
            Download & Installation
          </Text>
        </Column>
      </Row>

      <Row className="ny-page-split-layout" gap="24">
        {/* Left Column: Extraction & Loading Steps */}
        <Column className="ny-download-left-col" gap="16" style={{ flex: "1.1", minWidth: 0 }}>
          <Text variant="body-strong-m" className="ny-panel-subtitle">
            Installation Tutorial (ZIP Release)
          </Text>
          
          <div className="ny-scroll-box" style={{ flex: 1, overflowY: "auto", paddingRight: 10 }}>
            <div className="ny-install-checklist">
              <div className="ny-checklist-item">
                <div className="ny-item-circle">1</div>
                <div className="ny-item-content">
                  <Text variant="body-strong-s">Download Nyrima Extension</Text>
                  <p className="ny-checklist-desc">
                    Click the <strong>Download ZIP</strong> button above to download the latest pre-compiled build of the extension (<code>nyrima-v0.1.0-beta.zip</code>).
                  </p>
                </div>
              </div>

              <div className="ny-checklist-item">
                <div className="ny-item-circle">2</div>
                <div className="ny-item-content">
                  <Text variant="body-strong-s">Extract the Archive</Text>
                  <p className="ny-checklist-desc">
                    Extract the downloaded ZIP file to a convenient, permanent directory on your computer (this folder will contain files like <code>manifest.json</code>).
                  </p>
                </div>
              </div>

              <div className="ny-checklist-item">
                <div className="ny-item-circle">3</div>
                <div className="ny-item-content">
                  <Text variant="body-strong-s">Open Chrome Extensions</Text>
                  <p className="ny-checklist-desc">
                    Navigate to <code>chrome://extensions</code> in your Chrome browser address bar.
                  </p>
                </div>
              </div>

              <div className="ny-checklist-item">
                <div className="ny-item-circle">4</div>
                <div className="ny-item-content">
                  <Text variant="body-strong-s">Enable Developer Mode</Text>
                  <p className="ny-checklist-desc">
                    Toggle the <strong>Developer Mode</strong> switch located in the top-right corner of the Extensions page.
                  </p>
                </div>
              </div>

              <div className="ny-checklist-item">
                <div className="ny-item-circle">5</div>
                <div className="ny-item-content">
                  <Text variant="body-strong-s">Load Unpacked Extension</Text>
                  <p className="ny-checklist-desc">
                    Click the <strong>Load unpacked</strong> button in the top-left corner, and select the folder containing the extracted extension files.
                  </p>
                </div>
              </div>

              <div className="ny-checklist-item">
                <div className="ny-item-circle">6</div>
                <div className="ny-item-content">
                  <Text variant="body-strong-s">Configure & Play</Text>
                  <p className="ny-checklist-desc">
                    Open Nyrima from your extensions toolbar, enter your Google Drive API credentials (BYOK), select your root media folder, and start streaming!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Column>

        {/* Right Column: Setup Walkthrough Video */}
        <Column className="ny-download-right-col" gap="16" style={{ flex: "1", minWidth: 0, justifyContent: "center" }}>
          <Row horizontal="between" vertical="center" width="100%">
            <Text variant="body-strong-m" className="ny-panel-subtitle">
              Video Setup Guide
            </Text>
            <Row vertical="center" gap="4" className="ny-mint-text">
              <Sparkles size={14} />
              <Text variant="body-strong-xs" style={{ letterSpacing: "0.5px" }}>
                STEP-BY-STEP
              </Text>
            </Row>
          </Row>

          <div className="ny-video-glowing-card">
            {!isVideoPlaying ? (
              <div className="ny-video-poster" onClick={() => setIsVideoPlaying(true)}>
                <div className="ny-video-backdrop-overlay" />
                <div className="ny-play-circle-btn">
                  <Play size={28} fill="currentColor" />
                </div>
                <div className="ny-video-poster-info">
                  <Music size={18} className="ny-cyan-text" />
                  <div>
                    <Text variant="body-strong-s">Nyrima Official Theme - First and Last Gift</Text>
                    <p className="ny-video-duration">Duration: 3:31 • Music Showcase</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="ny-video-iframe-container">
                {/* Embedded YouTube video */}
                <iframe
                  width="100%"
                  height="100%"
                  src="https://www.youtube.com/embed/6LV2dNLnN5o?autoplay=1&si=uqETiu_KZrb8xKGJ"
                  title="YouTube video player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                ></iframe>
              </div>
            )}
          </div>

          {/* Chrome recommendation warning */}
          <div className="ny-browser-warning">
            <AlertTriangle className="ny-warning-icon" size={16} />
            <p className="ny-warning-text">
              <strong>Notice:</strong> Nyrima is optimized specifically for <strong>Google Chrome</strong>. Other browsers like Microsoft Edge or Brave might encounter playback errors.
            </p>
          </div>

          {/* Action Shape Buttons */}
          <div className="ny-shape-button-container">
            <div 
              className="ny-shape-btn chrome-theme" 
              onClick={() => window.open(buildZipUrl, "_blank")}
            >
              <div className="ny-shape-btn-glow" />
              <div className="ny-shape-icon-wrapper">
                <Chrome size={28} />
              </div>
              <span className="ny-shape-title">Chrome ZIP Release</span>
              <p className="ny-shape-subtitle">Download Extension</p>
            </div>

            <div 
              className="ny-shape-btn github-theme" 
              onClick={() => window.open(repoUrl, "_blank")}
            >
              <div className="ny-shape-btn-glow" />
              <div className="ny-shape-icon-wrapper">
                <Github size={28} />
              </div>
              <span className="ny-shape-title">GitHub Repository</span>
              <p className="ny-shape-subtitle">Explore Code & Issues</p>
            </div>
          </div>
        </Column>
      </Row>
    </Column>
  );
}
