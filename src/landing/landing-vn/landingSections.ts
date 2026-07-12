/**
 * Landing VN content model.
 *
 * The whole landing is data-driven: four CHAPTERS, each branching into
 * SUBSECTIONS through VN-style choices. A chapter opens to its first subsection
 * by default; selecting a subsection swaps the information panel content (a
 * discriminated `PanelContent` union). Rendering lives in the LandingVN*
 * components; navigation in useLandingSections. Add or reword content here
 * without touching either — this is the single source of truth for landing copy.
 *
 * Tone: friendly, anime-aware, lightly playful, warm, trustworthy. Ny-chan is a
 * guide, not a support bot. Keep dialogue short (2–3 lines — the box is a fixed
 * size and never grows); keep the long, structured product/legal text in panels.
 */

import {
  AudioLines,
  Captions,
  Clapperboard,
  Compass,
  Database,
  Film,
  FolderOpen,
  Github,
  Heart,
  History,
  KeyRound,
  LayoutGrid,
  Library,
  ListVideo,
  Lock,
  Mail,
  MonitorPlay,
  Palette,
  PlaySquare,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Emotion } from "./mascotArt";

export const SPEAKER = {
  name: "Ny-chan",
  role: "Nyrima's Guide",
};

const REPO = "https://github.com/EndlessMelody/Nyrima";
const CONTACT = "mailto:phankhoa170506@gmail.com";

/* ── Panel content shapes ──────────────────────────────────────────────────
 * Each subsection declares one of these. The InfoGlassPanel switches on `kind`
 * and renders the matching layout (cards, pills, FAQ, bullet panels, …). */

export interface IconItem {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface TechModule {
  id: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  pills: string[];
  impact: string;
}

/** The three tech modules, defined once and shared by all Tech subsections so
 *  the grid can always show all three with one highlighted. */
export const TECH_MODULES: TechModule[] = [
  {
    id: "ui",
    icon: Palette,
    title: "UI / Frontend",
    desc: "Shapes the interface, the scene flow, the interaction feel, and the visual clarity of everything you touch.",
    pills: ["React", "TypeScript", "Once UI", "SCSS"],
    impact:
      "This stack is responsible for how polished, readable, and VN-like Nyrima feels.",
  },
  {
    id: "media",
    icon: MonitorPlay,
    title: "Playback / Media",
    desc: "Handles playback behavior, subtitle support, audio tracks, and the anime-focused media experience.",
    pills: ["custom player layer", "MKV / MP4", "subtitle rendering", "multi-audio"],
    impact: "If the player feels more careful than a random web tab, this is why.",
  },
  {
    id: "data",
    icon: Database,
    title: "Platform / Data",
    desc: "Connects Nyrima to your own library and keeps the content usable instead of scattered.",
    pills: ["Google Drive API", "OAuth", "metadata handling", "library indexing", "resume state"],
    impact:
      "This is the part that helps Nyrima understand your library instead of treating it like a pile of nameless files.",
  },
];

/* ── Dialogue line + choice model ──────────────────────────────────────────
 * A line is either a plain string (inherits the node's emotion) or an object
 * with a per-line `emotion` override — lets one beat shift Ny-chan's
 * expression mid-node (e.g. teary → determined). A `DialogueChoice` turns the
 * end of a node's lines into a VN-style choice: 2–3 options, each with its own
 * reply lines and (optionally) its own emotion while delivering them. */

export type DialogueLine = string | { text: string; emotion?: Emotion };

export interface DialogueChoiceOption {
  id: string;
  /** Option button text — the visitor's "line". */
  label: string;
  /** Ny-chan's reply once this option is picked. */
  reply: DialogueLine[];
  /** Emotion while delivering the reply (per-line overrides still win). */
  emotion?: Emotion;
}

export interface DialogueChoice {
  /** Optional prompt shown above the options. */
  prompt?: string;
  /** 2–3 options. */
  options: DialogueChoiceOption[];
}

/** Shape shared by INTRO_DIALOGUE / INDEX_DIALOGUE. */
export interface NodeDialogue {
  emotion: Emotion;
  lines: DialogueLine[];
  choice?: DialogueChoice;
}

export type PanelContent =
  | { kind: "about"; lead: string; cards: IconItem[] }
  | { kind: "painPoints"; pairs: { problem: string; solution: string }[] }
  | { kind: "steps"; steps: IconItem[] }
  | { kind: "features"; cards: IconItem[] }
  | { kind: "tech"; activeId: string }
  | {
      kind: "policy";
      tone: "privacy" | "commitments";
      blocks: { icon: LucideIcon; title: string; points: string[] }[];
    }
  | { kind: "faq"; items: { q: string; a: string }[] }
  | { kind: "prose"; lead?: string; blocks: { title?: string; body: string }[]; pills?: string[] }
  | {
      kind: "profile";
      name: string;
      role: string;
      blurb: string;
      pills: string[];
      links: { label: string; href: string; icon: LucideIcon }[];
    };

export interface Subsection {
  id: string;
  /** Tab label / VN option text. */
  label: string;
  /** Mascot expression while this subsection is open. */
  emotion: Emotion;
  /** Ny-chan's lines — short and lively (2–3 lines max). */
  dialogue: DialogueLine[];
  /** Optional VN choice offered once the dialogue finishes. */
  choice?: DialogueChoice;
  /** What fills the information panel. */
  panel: PanelContent;
}

export interface Chapter {
  id: string;
  /** 1-based chapter number, shown as "CHAPTER 0X". */
  chapterNumber: number;
  /** Short chapter title (chapter header + index card). */
  title: string;
  /** One-line description for the chapter index card. */
  subtitle: string;
  /** Index-card icon / chapter-header icon. */
  icon: LucideIcon;
  /** Mascot expression when the chapter is first opened. */
  mascotExpression: Emotion;
  /** Ny-chan's lines on first entering the chapter (before a subsection pick). */
  introDialogue: DialogueLine[];
  /** Optional VN choice offered once the chapter intro dialogue finishes. */
  introChoice?: DialogueChoice;
  subsections: Subsection[];
}

/** The opening VN beat — shown on load before any chapter cards appear. The
 *  visitor advances through these 2–3 short pages, then the index reveals. */
export const INTRO_DIALOGUE: NodeDialogue = {
  emotion: "happy",
  lines: [
    "Welcome to Nyrima — your private anime library, reimagined.",
    "I'll show you what it does, what it uses, and how it treats your library.",
  ],
  choice: {
    prompt: "Quick one before we start —",
    options: [
      {
        id: "first-time",
        label: "First time here",
        reply: [
          {
            text: "Aw, a new face! Okay, I'll go a little slower and explain things as we go.",
            emotion: "adoring",
          },
        ],
        emotion: "adoring",
      },
      {
        id: "know-the-drill",
        label: "I've seen a VN landing before",
        reply: [
          {
            text: "Ooh, a veteran. Fine — I'll keep the chit-chat tight and get to the good parts.",
            emotion: "smug",
          },
        ],
        emotion: "smug",
      },
    ],
  },
};

/** Spoken at the chapter index once the intro is done (and on returning via
 *  "All Chapters"). This is the third intro beat — it lands as the four cards
 *  reveal, so the prompt and the choices appear together. The choice only
 *  applies on a true first visit (it disappears once `visited` is non-empty
 *  and a revisit greeting takes over). */
export const INDEX_DIALOGUE: NodeDialogue = {
  emotion: "happy",
  lines: ["Pick a chapter when you're ready — I'll take it from there."],
  choice: {
    prompt: "Before you dive in — want a quick recommendation?",
    options: [
      {
        id: "recommend",
        label: "Sure, where should I start?",
        reply: [
          {
            text: "Welcome → \"What is Nyrima\" — it's the fastest way to get oriented before anything else.",
            emotion: "pointing",
          },
        ],
        emotion: "pointing",
      },
      {
        id: "just-browsing",
        label: "Actually, maybe I'll just head out",
        reply: [
          { text: "Wait, already?! We just got started—", emotion: "surprised" },
          {
            text: "...okay, okay. No pressure. The chapters aren't going anywhere, and neither am I.",
            emotion: "panicked",
          },
        ],
      },
    ],
  },
};

export const chapters: Chapter[] = [
  /* ── CHAPTER 01 · WELCOME ──────────────────────────────────────────────── */
  {
    id: "welcome",
    chapterNumber: 1,
    title: "Welcome",
    subtitle: "What Nyrima is, what it solves, and how to start.",
    icon: Compass,
    mascotExpression: "happy",
    introDialogue: [
      "Let's start with the basics.",
      "What do you want to know first?",
    ],
    introChoice: {
      prompt: "Want the tour, or should I jump to what Nyrima actually does?",
      options: [
        {
          id: "tour",
          label: "Give me the tour",
          reply: [
            { text: "Perfect — let's go in order. Tap a tab up top whenever you're ready.", emotion: "happy" },
          ],
        },
        {
          id: "features",
          label: "Just show me what it does",
          reply: [
            {
              text: "Straight to business, got it. \"Features\" is the one you want — but the others are good too!",
              emotion: "pointing",
            },
          ],
        },
      ],
    },
    subsections: [
      {
        id: "what",
        label: "What is Nyrima?",
        emotion: "neutral",
        dialogue: [
          "Nyrima is what happens when a private anime folder stops feeling like a folder and starts feeling like a place.",
        ],
        panel: {
          kind: "about",
          lead: "A private anime library experience built around your own Google Drive — not another folder, an actual home for the rips you care about.",
          cards: [
            {
              icon: Library,
              title: "A library, not a folder",
              body: "Point Nyrima at your Drive and it becomes shelves of titles and episodes instead of a wall of file names.",
            },
            {
              icon: Sparkles,
              title: "Open, organize, continue",
              body: "It helps you open titles cleanly, keep them tidy, and pick up exactly where you left off.",
            },
            {
              icon: Clapperboard,
              title: "Anime-first by design",
              body: "Built around anime-friendly playback and library continuity, not generic video-on-the-web.",
            },
          ],
        },
      },
      {
        id: "problems",
        label: "Problems it solves",
        emotion: "determined",
        dialogue: [
          { text: "You already know the pain — messy folders, broken subtitles, lost progress...", emotion: "teary" },
          { text: "...so here's what I quietly fix while you just press play.", emotion: "determined" },
        ],
        panel: {
          kind: "painPoints",
          pairs: [
            { problem: "Messy folders", solution: "A cleaner anime library flow with real shelves" },
            { problem: "Weak subtitle support", solution: "Subtitle-aware playback that keeps your styling" },
            { problem: "Losing episode progress", solution: "Resume continuity, down to the second" },
            { problem: "Generic video-player feel", solution: "An anime-first experience built for the way you watch" },
          ],
        },
      },
      {
        id: "how",
        label: "How to use it",
        emotion: "pointing",
        dialogue: [
          "I tried to make the first few steps obvious. Four moves and you're watching.",
        ],
        panel: {
          kind: "steps",
          steps: [
            {
              icon: FolderOpen,
              title: "Connect your Drive folder",
              body: "Choose the Drive folder where your anime already lives. Nothing moves or uploads.",
            },
            {
              icon: LayoutGrid,
              title: "Let Nyrima organize it",
              body: "Subfolders become shelves and titles, arranged into a clean library view.",
            },
            {
              icon: ListVideo,
              title: "Open a title, pick an episode",
              body: "Browse a series, see its episodes laid out, and choose where to jump in.",
            },
            {
              icon: PlaySquare,
              title: "Watch, with everything intact",
              body: "Subtitles, audio handling, and continuity support carry you through the episode.",
            },
          ],
        },
      },
      {
        id: "features",
        label: "Features",
        emotion: "proud",
        dialogue: [
          "These are the parts doing the real work while I stand here looking cute.",
        ],
        panel: {
          kind: "features",
          cards: [
            { icon: Film, title: "MKV / MP4", body: "Plays the rips you actually have, at the quality you ripped them." },
            { icon: Captions, title: "ASS / SRT subtitles", body: "Styled signs, karaoke, and positioning survive — not flat white text." },
            { icon: AudioLines, title: "Multi-audio", body: "Switch between dubs, commentary, and language tracks on the fly." },
            { icon: History, title: "Resume memory", body: "Continuity that remembers your seat across tabs and devices." },
            { icon: Library, title: "Folder-based library", body: "A cleaner shelf flow on top of the folders you already keep." },
            { icon: Heart, title: "Anime-friendly playback", body: "Tuned for fansub quirks and the way anime is actually packaged." },
          ],
        },
      },
    ],
  },

  /* ── CHAPTER 02 · TECH STACK ───────────────────────────────────────────── */
  {
    id: "tech",
    chapterNumber: 2,
    title: "Tech Stack",
    subtitle: "The tools and layers behind the experience.",
    icon: Server,
    mascotExpression: "proud",
    introDialogue: [
      "This is the machinery behind the curtain.",
      { text: "And yeah, I'm a little proud of it. Which layer do you want?", emotion: "smug" },
    ],
    subsections: [
      {
        id: "ui",
        label: "UI / Frontend",
        emotion: "pointing",
        dialogue: [
          "This stack is responsible for how polished, readable, and VN-like Nyrima feels.",
        ],
        panel: { kind: "tech", activeId: "ui" },
      },
      {
        id: "media",
        label: "Playback / Media",
        emotion: "proud",
        dialogue: ["If the player feels more careful than a random web tab, this is why."],
        panel: { kind: "tech", activeId: "media" },
      },
      {
        id: "data",
        label: "Platform / Data",
        emotion: "thinking",
        dialogue: [
          "This is the part that helps me understand your library instead of treating it like a pile of nameless files.",
        ],
        panel: { kind: "tech", activeId: "data" },
      },
    ],
  },

  /* ── CHAPTER 03 · TRUST & PRIVACY ──────────────────────────────────────── */
  {
    id: "trust",
    chapterNumber: 3,
    title: "Trust & Privacy",
    subtitle: "Permissions, privacy, rules, and Q&A.",
    icon: ShieldCheck,
    mascotExpression: "thinking",
    introDialogue: [
      "Here's what Nyrima touches, what it never touches, and what I expect from you.",
      "Pick one. I'll be straight with you.",
    ],
    subsections: [
      {
        id: "privacy",
        label: "Privacy Policy",
        emotion: "neutral",
        dialogue: ["Private libraries should feel private. That part is not negotiable."],
        panel: {
          kind: "policy",
          tone: "privacy",
          blocks: [
            {
              icon: KeyRound,
              title: "What access Nyrima needs",
              points: [
                "Only the access required for the library to work — reading your chosen folder and the files inside it.",
                "Nothing broader than that, and nothing you have not granted.",
              ],
            },
            {
              icon: Lock,
              title: "Your files remain in your Drive",
              points: [
                "Nyrima is built around your own Drive library and streams from it directly.",
                "Your videos are never copied onto some other server to be played.",
              ],
            },
            {
              icon: ShieldCheck,
              title: "What Nyrima does not do",
              points: [
                "It does not require making your folders public.",
                "No analytics pixels, no ad trackers, no quietly hoarding your data.",
              ],
            },
            {
              icon: UserRound,
              title: "Transparency & control",
              points: [
                "You stay in control of access permissions and can revoke them whenever you want.",
                "The project is open source, so you can read exactly what it asks for.",
              ],
            },
          ],
        },
      },
      {
        id: "commitments",
        label: "User Commitments",
        emotion: "proud",
        dialogue: [
          "Nyrima helps you care for your own library. It is not here to excuse bad behavior.",
        ],
        panel: {
          kind: "policy",
          tone: "commitments",
          blocks: [
            {
              icon: FolderOpen,
              title: "Use what is yours",
              points: ["Only open content you own or are genuinely allowed to access."],
            },
            {
              icon: Heart,
              title: "Respect creators & platforms",
              points: ["The people who make anime deserve support. Nyrima is not a workaround for that."],
            },
            {
              icon: ShieldCheck,
              title: "Don't redistribute",
              points: ["Do not use Nyrima to hand copyrighted content out to others."],
            },
            {
              icon: Library,
              title: "A private library, not a service",
              points: ["Nyrima is a private library experience — not a piracy service, and never pretending to be one."],
            },
          ],
        },
      },
      {
        id: "qa",
        label: "Q&A",
        emotion: "pointing",
        dialogue: [
          { text: "Mm, handing over Drive access can feel a little unsettling — I get it.", emotion: "confused" },
          { text: "If you still have doubts, good. Pick a question.", emotion: "pointing" },
        ],
        choice: {
          prompt: "One more thing, while we're here —",
          options: [
            {
              id: "skeptic",
              label: "I'm still a little skeptical",
              reply: [
                {
                  text: "Good. That's exactly the right energy to have before handing over Drive access.",
                  emotion: "determined",
                },
                { text: "Read through these — and the source is public, so nothing's hiding.", emotion: "proud" },
              ],
            },
            {
              id: "curious",
              label: "Just curious, honestly",
              reply: [{ text: "Ehehe, fair enough! Curiosity is good too." }],
              emotion: "happy",
            },
          ],
        },
        panel: {
          kind: "faq",
          items: [
            {
              q: "Does Nyrima make my folder public?",
              a: "No. Nyrima works against your own private Drive library. It never requires you to share folders publicly, and it does not flip any visibility settings on your behalf.",
            },
            {
              q: "What file types does Nyrima support?",
              a: "It is built for the way anime is actually packaged: MKV and MP4 video, with ASS/SSA and SRT subtitles, plus multiple embedded audio tracks.",
            },
            {
              q: "Can it remember where I stopped?",
              a: "Yes. Resume continuity is a core feature — close an episode mid-way and Nyrima keeps your place so you can pick up on the same second later.",
            },
            {
              q: "Does it upload my files somewhere else?",
              a: "No. Your videos stay in your Drive and stream from there. There is no hosted copy of your library sitting on someone else's server.",
            },
            {
              q: "Is Nyrima a streaming service?",
              a: "No. Nyrima is a private library experience layered over your own storage — it does not host, sell, or distribute any content.",
            },
          ],
        },
      },
    ],
  },

  /* ── CHAPTER 04 · BEHIND NYRIMA ────────────────────────────────────────── */
  {
    id: "behind",
    chapterNumber: 4,
    title: "Behind Nyrima",
    subtitle: "The developer, the reason, and the direction.",
    icon: Wand2,
    mascotExpression: "happy",
    introDialogue: [
      "Nyrima didn't appear out of nowhere.",
      "It exists because someone got tired of watching anime in clumsy ways. Want the human side?",
    ],
    subsections: [
      {
        id: "developer",
        label: "The Developer",
        emotion: "neutral",
        dialogue: [
          "A small team of one, honestly. Let me introduce them.",
          { text: "...Ehehe, it's always a little strange talking about this part.", emotion: "shy" },
        ],
        panel: {
          kind: "profile",
          name: "Khoa",
          role: "Builder & sole developer of Nyrima",
          blurb:
            "An anime watcher who kept fighting their own Google Drive to watch a show, and eventually decided to build the player they wished already existed. Nyrima is that player.",
          pills: ["frontend", "media playback", "anime nerd", "subtitle perfectionist"],
          links: [
            { label: "GitHub", href: REPO, icon: Github },
            { label: "Contact", href: CONTACT, icon: Mail },
          ],
        },
      },
      {
        id: "why",
        label: "Why it exists",
        emotion: "thinking",
        dialogue: [
          "This part is a little personal. Bear with me.",
          {
            text: "But that frustration is exactly why Nyrima exists now — and I'm genuinely glad it does.",
            emotion: "adoring",
          },
        ],
        panel: {
          kind: "prose",
          lead: "Nyrima started as frustration, not a product plan.",
          blocks: [
            {
              title: "The folders were a maze",
              body: "Anime rips piled up in Drive as endless nested folders with cryptic names. Finding the next episode felt like archaeology.",
            },
            {
              title: "The playback kept letting me down",
              body: "Browser previews choked on MKV, mangled the subtitles, and forgot where I stopped the moment I closed the tab.",
            },
            {
              title: "I wanted somewhere that felt mine",
              body: "Not a generic player bolted onto storage — a calmer, anime-specific, private place to actually watch the things I had carefully collected.",
            },
          ],
        },
      },
      {
        id: "future",
        label: "Where it's going",
        emotion: "happy",
        dialogue: [
          "I don't just want Nyrima to work. I want it to feel like it belongs to the people who really live in their anime folders.",
        ],
        panel: {
          kind: "prose",
          lead: "Where this is all heading.",
          blocks: [
            {
              title: "A personal anime sanctuary",
              body: "A space that feels warm and yours, not like a utility you tolerate.",
            },
            {
              title: "A cleaner player & library",
              body: "Continuing to sharpen the playback and the shelves until they feel effortless.",
            },
            {
              title: "Designed around anime habits",
              body: "Shaped by how people actually binge, rewatch, and hoard — not generic media playback.",
            },
          ],
          pills: ["sanctuary", "continuity", "anime-shaped", "yours"],
        },
      },
    ],
  },
];
