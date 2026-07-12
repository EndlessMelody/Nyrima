import { useState } from "react";
import { Column, Row, Text } from "@once-ui-system/core/components";
import { Search, ChevronDown, HelpCircle, AlertCircle, PlayCircle, Settings, Share2 } from "lucide-react";

type QaItem = {
  question: string;
  answer: string;
  category: "general" | "oauth" | "drive" | "playback" | "sharing";
};

export function QaPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const categories = [
    { id: "all", label: "All Questions", icon: HelpCircle },
    { id: "general", label: "General", icon: AlertCircle },
    { id: "oauth", label: "OAuth Connect", icon: Settings },
    { id: "drive", label: "Drive Access", icon: Settings },
    { id: "playback", label: "Playback & Subtitles", icon: PlayCircle },
    { id: "sharing", label: "Sharing & Imports", icon: Share2 }
  ];

  const qaList: QaItem[] = [
    {
      question: "What exactly is Nyrima? Is it a media streaming backend?",
      answer: "No. Nyrima is a local-first Chrome extension that turns your personal Google Drive directories into media libraries. There is no Nyrima hosted backend, transcoding servers, or analytics trackers. Your video files stream directly from Google's servers to your web browser.",
      category: "general"
    },
    {
      question: "Why should I use Nyrima instead of standard Google Drive preview?",
      answer: "Google Drive's built-in preview limits stream quality to low resolutions and compresses audio. Nyrima fetches original media bytes directly, enabling full high-definition video playback, support for external and embedded styled ASS subtitles, chapter markers, and remember progress state.",
      category: "general"
    },
    {
      question: "My OAuth client is giving redirect URL or invalid client ID errors. How do I fix it?",
      answer: "Make sure you created a 'Chrome Extension' client ID in Google Cloud Platform Console, and verify that the extension ID in Chrome matches the client configuration. Reloading the extension unpacked folder can change the ID if not loaded consistently.",
      category: "oauth"
    },
    {
      question: "Why does the OAuth login expire every few days?",
      answer: "Nyrima enforces a 72-hour interactive consent session for security. Since it has no central backend server to refresh offline tokens, your credentials stay locally and you will be asked to authenticate again when the local lease expires.",
      category: "oauth"
    },
    {
      question: "Can I open private Google Drive folders using an API key?",
      answer: "No, API Keys are restricted to public assets ('Anyone with the link'). To access your private personal libraries, configure the OAuth Client ID and log in using your Google account.",
      category: "drive"
    },
    {
      question: "Drive listing returns 403 quota or rate limit exceeded errors. What should I do?",
      answer: "This is a Google-side API rate ceiling. Try logging in using signed-in OAuth access for private directories. If utilizing public files, wait a short period or restrict concurrent indexing.",
      category: "drive"
    },
    {
      question: "Why does my MKV video file fail to play or have missing audio?",
      answer: "Chrome does not natively support several audio/video codecs commonly packaged in MKV containers (e.g. HEVC/AC-3/DTS). Nyrima remuxes supported audio/video splits in the background via Media Source Extensions. If a file fails, try a standard MP4 file to confirm your connection.",
      category: "playback"
    },
    {
      question: "Subtitles are not rendering or missing formatting. What should I inspect?",
      answer: "Ensure external subtitle tracks are in the same folder as the video and match the base video name (e.g., VideoName.mkv and VideoName.en.ass). Nyrima loads styled ASS/SSA using JASSUB to preserve fansub layouts.",
      category: "playback"
    },
    {
      question: "Another user followed my Shared library, but they can't import the file. Why?",
      answer: "Sharing is split into index files and actual media permissions. The follower must have access rights to the underlying target files in Google Drive. If the media files themselves remain private, the import will fail.",
      category: "sharing"
    },
    {
      question: "Does deleting a Shared folder in Nyrima delete files for my followers?",
      answer: "Deleting your Shared manifest or stopping folder access stops future updates, but it cannot delete copies or caches that other users have already imported or copied server-side into their own Drives.",
      category: "sharing"
    }
  ];

  // Filter QA items
  const filteredQa = qaList.filter((item) => {
    const matchesSearch =
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <Column className="ny-page-container fade-in">
      <Row className="ny-page-header-row" horizontal="between" vertical="center" gap="20">
        <Column gap="4">
          <Text className="section-kicker" variant="body-strong-xs">
            PRODUCT Q&A
          </Text>
          <Text variant="heading-strong-l" className="ny-page-title">
            Frequently Asked Questions
          </Text>
        </Column>

        <Row className="ny-search-wrapper" vertical="center" gap="8">
          <Search size={16} className="ny-search-icon" />
          <input
            type="text"
            className="ny-search-input"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </Row>
      </Row>

      <Row className="ny-page-split-layout" gap="24">
        {/* Left Side: Categories */}
        <Column className="ny-qa-sidebar" gap="8">
          <Text variant="body-strong-xs" className="ny-toc-title">
            CATEGORIES
          </Text>
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                className={`ny-qa-cat-btn ${selectedCategory === cat.id ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setExpandedIndex(null);
                }}
              >
                <Icon size={14} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </Column>

        {/* Right Side: Accordion Questions */}
        <div className="ny-qa-panel">
          <div className="ny-scroll-box" style={{ flex: 1, overflowY: "auto", paddingRight: 8 }}>
            {filteredQa.length > 0 ? (
              <Column gap="12">
                {filteredQa.map((item, idx) => {
                  const isExpanded = expandedIndex === idx;
                  return (
                    <div
                      className={`ny-qa-accordion-item ${isExpanded ? "is-expanded" : ""}`}
                      key={idx}
                    >
                      <button
                        className="ny-qa-question-btn"
                        onClick={() => toggleExpand(idx)}
                      >
                        <Text variant="body-strong-s" style={{ textAlign: "left", flex: 1 }}>
                          {item.question}
                        </Text>
                        <ChevronDown size={16} className="ny-qa-chevron" />
                      </button>
                      <div className="ny-qa-answer-wrapper">
                        <p className="ny-qa-answer">{item.answer}</p>
                      </div>
                    </div>
                  );
                })}
              </Column>
            ) : (
              <Column center gap="16" style={{ height: "100%", opacity: 0.6, paddingTop: 40 }}>
                <HelpCircle size={48} />
                <Text variant="body-strong-m">No questions found matching search criteria.</Text>
              </Column>
            )}
          </div>
        </div>
      </Row>
    </Column>
  );
}
