import { useState, useRef, useEffect } from "react";
import { Column, Row, Text, Button } from "@once-ui-system/core/components";
import { FileText, Shield, Scale, ArrowRight, ExternalLink } from "lucide-react";

type LegalTab = "terms" | "privacy" | "license";

export function TermsPage({ defaultTab = "terms" }: { defaultTab?: LegalTab } = {}) {
  const [activeTab, setActiveTab] = useState<LegalTab>(defaultTab);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to top when tab changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const termsSections = [
    { id: "desc", title: "1. Service Description" },
    { id: "rights", title: "2. User Content & Rights" },
    { id: "drive", title: "3. Google Drive Access" },
    { id: "sharing", title: "4. Optional Sharing" },
    { id: "imports", title: "5. Imports" },
    { id: "config", title: "6. Configuration & BYOK" },
    { id: "prohibited", title: "7. Prohibited Use" },
    { id: "third-party", title: "8. Third-Party Services" },
    { id: "warranty", title: "9. Disclaimer of Warranties" },
    { id: "responsibility", title: "10. Limitation of Liability" },
    { id: "indemnity", title: "11. Indemnification" },
    { id: "affiliation", title: "12. Trademark & Affiliation Disclaimer" },
    { id: "dmca", title: "13. DMCA & Copyright Policy" },
    { id: "governing", title: "14. Governing Law & Jurisdiction" },
    { id: "changes-t", title: "15. Updates to Terms" },
  ];

  const privacySections = [
    { id: "summary", title: "Summary of Principles" },
    { id: "access", title: "Data Nyrima Accesses" },
    { id: "use", title: "How Nyrima Uses Data" },
    { id: "storage", title: "Where Data Is Stored" },
    { id: "sharing-p", title: "Optional Public Sharing" },
    { id: "destinations", title: "Network Destinations" },
    { id: "sale", title: "Sale & Advertising" },
    { id: "limited-use", title: "Google API Limited Use" },
    { id: "gdpr-ccpa", title: "GDPR & CCPA Rights" },
    { id: "coppa", title: "Children's Privacy (COPPA)" },
    { id: "security", title: "Security Measures" },
    { id: "changes-p", title: "Changes to Privacy Policy" },
  ];

  const licenseSections = [
    { id: "mit", title: "MIT License" },
    { id: "third-party-lic", title: "Third-Party Attributions" },
    { id: "trademark-disclaimer", title: "Trademarks" },
  ];

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el && contentRef.current) {
      const topPos = el.offsetTop - 20;
      contentRef.current.scrollTo({
        top: topPos,
        behavior: "smooth",
      });
    }
  };

  const getSections = () => {
    if (activeTab === "terms") return termsSections;
    if (activeTab === "privacy") return privacySections;
    return licenseSections;
  };

  return (
    <Column className="ny-page-container fade-in">
      <Row className="ny-page-header-row" horizontal="between" vertical="center" gap="20">
        <Column gap="4">
          <Text className="section-kicker" variant="body-strong-xs">
            LEGAL DOCUMENTATION
          </Text>
          <Text variant="heading-strong-l" className="ny-page-title">
            Terms, Privacy & License
          </Text>
        </Column>

        <Row gap="8" className="ny-tab-buttons">
          <button
            className={`ny-tab-btn ${activeTab === "terms" ? "is-active" : ""}`}
            onClick={() => setActiveTab("terms")}
          >
            <FileText size={16} />
            Terms of Use
          </button>
          <button
            className={`ny-tab-btn ${activeTab === "privacy" ? "is-active" : ""}`}
            onClick={() => setActiveTab("privacy")}
          >
            <Shield size={16} />
            Privacy Policy
          </button>
          <button
            className={`ny-tab-btn ${activeTab === "license" ? "is-active" : ""}`}
            onClick={() => setActiveTab("license")}
          >
            <Scale size={16} />
            License
          </button>
        </Row>
      </Row>

      <Row className="ny-page-split-layout" gap="24">
        {/* Sticky Table of Contents Sidebar */}
        <Column className="ny-toc-sidebar" gap="12">
          <Text variant="body-strong-xs" className="ny-toc-title">
            SECTIONS
          </Text>
          <nav className="ny-toc-nav">
            {getSections().map((sec) => (
              <button
                key={sec.id}
                className="ny-toc-link"
                onClick={() => scrollToSection(sec.id)}
              >
                <ArrowRight size={12} className="ny-toc-icon" />
                <span>{sec.title}</span>
              </button>
            ))}
          </nav>
        </Column>

        {/* Scrollable Document Panel */}
        <div className="ny-doc-panel" ref={contentRef}>
          {activeTab === "terms" && (
            <div className="ny-markdown-content">
              <Text variant="heading-strong-m" className="ny-doc-h1">Nyrima Terms of Use</Text>
              <p className="ny-doc-meta">Last Updated: May 23, 2026</p>
              
              <p className="ny-doc-lead">
                Welcome to Nyrima. Please read these Terms of Use ("Terms") carefully. By installing, configuring, or using the Nyrima browser extension, you accept and agree to be bound by these Terms. If you do not agree to these Terms, do not install or use the extension.
              </p>

              <div className="ny-divider" />

              <h3 id="desc">1. Service Description</h3>
              <p>
                Nyrima is a client-side browser extension designed to help users play, stream, and organize video files stored in their own Google Drive accounts. All streaming, decoding, metadata scanning, and subtitle rendering (using JASSUB and WebGL) are processed locally inside the user's browser sandbox. Nyrima is <strong>not</strong> a media hosting service, CDN, or content distributor, and does not operate any servers that host, store, or transmit media files.
              </p>

              <h3 id="rights">2. User Content And Rights</h3>
              <p>
                You retain all rights to the files, video catalogs, subtitles, and artwork you access or stream through Nyrima. You are solely responsible for all content loaded, streamed, shared, or imported. You represent and warrant that you own or have the necessary legal rights, licenses, or permissions to stream and access all media files in your libraries. Nyrima does not verify copyright ownership and does not check the legality of your content.
              </p>

              <h3 id="drive">3. Google Drive Access</h3>
              <p>
                Nyrima relies entirely on the Google Drive API to function. Access to your Google Drive is authenticated locally via OAuth 2.0. You control all consent permissions, Google Cloud credentials, and API client keys. Quotas, connection speed, file availability, and download limits are governed strictly by Google's API policies and your account limits.
              </p>

              <h3 id="sharing">4. Optional Sharing</h3>
              <p>
                Nyrima includes an optional sharing feature that allows you to share library metadata with other users. This feature is entirely opt-in. When enabled, Nyrima generates a <code>Shared/</code> folder in your Google Drive containing metadata index files. By changing this folder's permission to link-readable, other users can read the index. This does <strong>not</strong> grant download rights to the actual files unless you separately configure file-level permissions in Google Drive. You are responsible for all metadata and comment streams you publish.
              </p>

              <h3 id="imports">5. Imports</h3>
              <p>
                The import feature performs a server-side copy operation on Google Drive, transferring shared items into your own Google Drive storage. You must ensure you have the legal right to copy and store the files before initiating an import. The developer is not liable for unauthorized copies made using this feature.
              </p>

              <h3 id="config">6. Access Configuration & BYOK (Bring Your Own Key)</h3>
              <p>
                Nyrima supports Bring Your Own Key (BYOK) mode, enabling you to input your own Google Cloud Console API Keys and OAuth Client Credentials. You are solely responsible for the creation, security, billing, and management of your Google Cloud projects. The developer is not liable for any charges, rate limit suspensions, or project terminations issued by Google in connection with your credentials.
              </p>

              <h3 id="prohibited">7. Prohibited Use</h3>
              <p>
                You agree not to use Nyrima to:
              </p>
              <ul>
                <li>Bypass digital rights management (DRM) or violate any copyrights, patents, trademarks, or trade secrets.</li>
                <li>Distribute unlawful, abusive, threatening, defamatory, or obscene metadata or comment streams.</li>
                <li>Bypass Google Drive security boundaries, API rate limits, or account restrictions.</li>
                <li>Misrepresent Google Drive file permissions or mislead other users to gain unauthorized access to their files.</li>
                <li>Run automated scraping, crawling, or DDoS attacks against Google APIs or GitHub infrastructure.</li>
              </ul>

              <h3 id="third-party">8. Third-Party Services</h3>
              <p>
                Nyrima interfaces directly with Google accounts, Google Drive APIs, and an optional GitHub repository for community directory lists. These third-party services are governed by their own terms and privacy policies. The developer of Nyrima does not control and is not responsible for the performance, terms, or availability of these platforms.
              </p>

              <h3 id="warranty">9. Disclaimer of Warranties</h3>
              <p className="ny-all-caps">
                THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. THE PUBLISHER DOES NOT WARRANT THAT THE EXTENSION WILL FUNCTION UNINTERRUPTED, SECURELY, OR BE COMPATIBLE WITH ALL VIDEO CODECS AND BROWSER ENVIRONMENT UPDATES.
              </p>

              <h3 id="responsibility">10. Limitation of Liability</h3>
              <p className="ny-all-caps">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE PUBLISHER, DEVELOPERS, OR CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF (A) YOUR USE OF OR INABILITY TO USE THE SOFTWARE; (B) ANY ACCIDENTAL DELETION OR CORRUPTION OF GOOGLE DRIVE FILES; (C) ANY RATE SUSPENSIONS OR FEES INCURRED ON YOUR GOOGLE CLOUD ACCOUNT; OR (D) THE UNAUTHORIZED SHARING OF LIBRARIES. IN NO EVENT SHALL THE TOTAL AGGREGATE LIABILITY EXCEED ZERO DOLLARS ($0.00).
              </p>

              <h3 id="indemnity">11. Indemnification</h3>
              <p>
                You agree to defend, indemnify, and hold harmless the publisher, developers, and contributors from and against any and all claims, damages, obligations, losses, liabilities, costs, and expenses (including attorney's fees) arising from: (i) your access to or use of Nyrima; (ii) your violation of these Terms; (iii) your infringement of any third-party intellectual property right, including copyright and trademark, through your libraries, shares, or comments; or (iv) your violation of Google API or Google Drive Terms of Service.
              </p>

              <h3 id="affiliation">12. Trademark & Affiliation Disclaimer</h3>
              <p>
                Nyrima is an independent open-source project. It is not affiliated with, authorized, sponsored, endorsed by, or in any way officially connected with Google LLC, Google Drive, Chrome Web Store, GitHub, or any of their subsidiaries or affiliates. All product names, logos, brands, and trademarks referenced herein are the property of their respective owners.
              </p>

              <h3 id="dmca">13. DMCA & Copyright Policy</h3>
              <p>
                Nyrima is a client-side utility tool. Because Nyrima does not host, store, cache, or distribute any media files on servers under the developer's control, the developer has no technical ability to take down or block access to copyright-infringing content stored in your private Google Drive. Any copyright infringement issues must be addressed directly with the user who holds the Google Drive folder, or with the hosting platform (Google LLC). If you believe a link in our optional public sharing directory violates copyright, you may submit a takedown request via GitHub Issues, and we will remove the link from the index within a reasonable timeframe.
              </p>

              <h3 id="governing">14. Governing Law & Jurisdiction</h3>
              <p>
                These Terms and your use of Nyrima are governed by and construed in accordance with the laws of the jurisdiction of the developer, without regard to its conflict of law principles. Any dispute arising out of or relating to these Terms shall be subject to the exclusive jurisdiction of the competent courts located in that jurisdiction.
              </p>

              <h3 id="changes-t">15. Updates to Terms</h3>
              <p>
                We reserve the right to modify these Terms at any time. When we make updates, we will update the "Last Updated" date at the top of this document. Continued use of Nyrima after changes are published constitutes agreement to the updated Terms.
              </p>

              <div className="ny-doc-box">
                <Text variant="body-strong-m">Questions or Feedback?</Text>
                <p>For inquiries, open an issue in the official GitHub repository.</p>
                <Button variant="tertiary" size="s" onClick={() => window.open("https://github.com/EndlessMelody/Nyrima/issues", "_blank")}>
                  Open GitHub Issues <ExternalLink size={12} style={{marginLeft: 6}} />
                </Button>
              </div>
            </div>
          )}

          {activeTab === "privacy" && (
            <div className="ny-markdown-content">
              <Text variant="heading-strong-m" className="ny-doc-h1">Nyrima Privacy Policy</Text>
              <p className="ny-doc-meta">Last Updated: May 23, 2026</p>

              <p className="ny-doc-lead">
                Your privacy is paramount. Nyrima operates with a zero-backend architecture. All media streaming, folder scanning, credential handling, and watch progress tracking happen entirely locally on your device.
              </p>

              <div className="ny-divider" />

              <h3 id="summary">Summary of Principles</h3>
              <ul>
                <li><strong>No Deployed Backend:</strong> Your data does not pass through any server owned by the developer. It flows directly from Google Drive to your local browser.</li>
                <li><strong>No Analytics or Tracking:</strong> We do not deploy telemetry, tracking cookies, advertising trackers, or analytics endpoints.</li>
                <li><strong>Local Storage:</strong> Stored API keys, OAuth tokens, playback states, and watch progress stay in your browser sandbox.</li>
              </ul>

              <h3 id="access">Data Nyrima Accesses</h3>
              <p>
                To provide its features, Nyrima requests access to the following data scopes:
              </p>
              <ul>
                <li><strong>drive.readonly:</strong> Used to list folder structure, read file metadata, and request media stream bytes from your Google Drive.</li>
                <li><strong>drive.file:</strong> Used to create and write the <code>Shared/</code> folder (metadata, comments) and copy files when you use the Import tool.</li>
                <li><strong>userinfo.email & userinfo.profile:</strong> Used optionally to display your Google profile picture and name in the account indicator.</li>
              </ul>

              <h3 id="use">How Nyrima Uses Data</h3>
              <p>
                Data accessed through Google APIs is processed locally for:
              </p>
              <ul>
                <li>Visualizing folders as media shelves in the library layout.</li>
                <li>Streaming video segments to the HTML5 video element.</li>
                <li>Displaying subtitle overlays and backdrop artwork.</li>
                <li>Maintaining local resume positions for your media.</li>
              </ul>

              <h3 id="storage">Where Data Is Stored</h3>
              <p>
                Application configurations and cache databases are saved locally using:
              </p>
              <ul>
                <li><code>chrome.storage.local</code>: For settings, credentials, and persistent library keys.</li>
                <li><code>chrome.storage.session</code>: Temporary storage for active OAuth access tokens.</li>
                <li><code>IndexedDB</code>: Local fast cache for scanned folders, filenames, and video segments.</li>
              </ul>

              <h3 id="sharing-p">Optional Public Sharing</h3>
              <p>
                If you opt to share a library, Nyrima creates an index file in a `Shared/` folder on your Google Drive. Only the folder is set to public (readable by link). This allows other users' browser extensions to read the titles and file structures you chose to share. You can turn off sharing and restore permissions to private at any time.
              </p>

              <h3 id="destinations">Network Destinations</h3>
              <p>
                Nyrima initiates connections only to:
              </p>
              <ul>
                <li>Google accounts (<code>accounts.google.com</code>) for OAuth login.</li>
                <li>Google APIs (<code>*.googleapis.com</code>) to list files and download streams.</li>
                <li>GitHub raw endpoints (<code>raw.githubusercontent.com</code>) to fetch the optional community shared library index.</li>
              </ul>

              <h3 id="sale">Sale & Advertising</h3>
              <p>
                Nyrima is completely free and open-source. We do not sell, rent, or lease your data, email, or Google files to brokers, advertising agencies, or data harvesters.
              </p>

              <h3 id="limited-use">Google API Limited Use</h3>
              <p>
                Nyrima's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
              </p>

              <h3 id="gdpr-ccpa">GDPR & CCPA Rights</h3>
              <p>
                Under European (GDPR) and Californian (CCPA) regulations, you have rights regarding access, deletion, and portability of your personal data. Because Nyrima has zero backend servers, we do not store, see, or possess any of your data. Therefore, we cannot process data export or deletion requests. You have complete control and can exercise these rights yourself:
              </p>
              <ul>
                <li><strong>To delete your data:</strong> Go to the extension settings and clear all local databases, or clear Chrome's site storage for the extension ID.</li>
                <li><strong>To revoke access:</strong> Visit your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google Account Security page</a> to revoke Nyrima's access to your Drive.</li>
              </ul>

              <h3 id="coppa">Children's Privacy (COPPA)</h3>
              <p>
                Nyrima is not directed to children under 13. We do not knowingly collect, store, or solicit personal information from children under 13. Since all data is stored locally in the browser sandbox, parents can delete any data entered by their children at any time by clearing the extension storage.
              </p>

              <h3 id="security">Security Measures</h3>
              <p>
                Tokens and API keys are stored locally using Chrome's secure storage APIs. While we implement security measures to protect your tokens locally, you are responsible for maintaining the physical and logical security of your device and browser profile against unauthorized access.
              </p>

              <h3 id="changes-p">Changes to Privacy Policy</h3>
              <p>
                We may revise this Privacy Policy from time to time. When updates occur, they will be reflected by the "Last Updated" date at the top of the policy page.
              </p>
            </div>
          )}

          {activeTab === "license" && (
            <div className="ny-markdown-content">
              <Text variant="heading-strong-m" className="ny-doc-h1">Software License & Attributions</Text>
              <p className="ny-doc-meta">Last Updated: May 23, 2026</p>

              <p className="ny-doc-lead">
                Nyrima is released as open-source software under the MIT License. Read the terms of the license and third-party library attributions below.
              </p>

              <div className="ny-divider" />

              <h3 id="mit">MIT License</h3>
              <div className="ny-license-block">
                <p>Copyright (c) 2026 Nyrima Contributors</p>
                <p>
                  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
                </p>
                <p>
                  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
                </p>
                <p className="ny-all-caps">
                  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
                </p>
              </div>

              <h3 id="third-party-lic">Third-Party Attributions</h3>
              <p>
                Nyrima leverages several open-source libraries. We are grateful to the open-source community for their contributions:
              </p>
              <ul>
                <li><strong>JASSUB:</strong> WebGL-based ASS subtitle renderer (MIT License).</li>
                <li><strong>React & TypeScript:</strong> Core library and type definitions (MIT License).</li>
                <li><strong>Once UI:</strong> Component design system (MIT License).</li>
                <li><strong>Lucide React:</strong> Vector icons library (ISC License).</li>
                <li><strong>Vite:</strong> Build system and hot-module replacement (MIT License).</li>
              </ul>

              <h3 id="trademark-disclaimer">Trademarks</h3>
              <p>
                "Google", "Google Drive", "Google Cloud Platform", "Chrome Web Store", and "GitHub" are registered trademarks of their respective owners. The use of these names does not imply any endorsement, sponsorship, or affiliation with Nyrima.
              </p>
            </div>
          )}
        </div>
      </Row>
    </Column>
  );
}
