/**
 * WelcomeBlock — pro landing surface introducing Nyrima.
 *
 * Sits at the top of the landing page for everyone (first-run users get a
 * full marketing pitch; returning users get a brand strip + quick CTA).
 * Renders three sections:
 *   - Hero            — mark, tagline, primary/secondary CTAs
 *   - FeatureGrid     — four value-prop cards
 *   - HowItWorks      — three-step setup walkthrough
 */

import { NyrimaMark } from "./NyrimaMark";
import "./WelcomeBlock.scss";

interface Props {
  /** True once the user has paired a Drive API key. */
  keyConfigured: boolean | null;
  /** Opens the folder-URL dialog. */
  onOpenFolder: () => void;
  /** Opens the setup access dialog. */
  onOpenSetup: () => void;
}

export function WelcomeBlock({
  keyConfigured,
  onOpenFolder,
  onOpenSetup,
}: Props) {
  // Primary CTA flips depending on setup state: brand-new users should go to
  // setup first; users with a key skip to the folder picker.
  const primary = keyConfigured
    ? { label: "Open a folder", onClick: onOpenFolder }
    : { label: "Setup access", onClick: onOpenSetup };
  const secondary = keyConfigured
    ? { label: "Setup access", onClick: onOpenSetup }
    : { label: "Open a folder", onClick: onOpenFolder };

  return (
    <section className="ny-welcome">
      <header className="ny-welcome__hero">
        <NyrimaMark size="splash" className="ny-welcome__mark" />
        <div className="ny-welcome__hero-body">
          <span className="ny-welcome__eyebrow">
            個人的な映画館 · NYRIMA
          </span>
          <h1 className="ny-welcome__title">
            Your Drive, made&nbsp;cinematic.
          </h1>
          <p className="ny-welcome__lede">
            Turn any Google Drive folder into a private cinema. Nothing
            uploads, nothing mirrors — your files stay where they live, you
            just get a player that treats them like the movies they are.
          </p>
          <div className="ny-welcome__cta">
            <button
              type="button"
              className="ny-btn ny-btn--primary"
              onClick={primary.onClick}
            >
              {primary.label}
            </button>
            <button
              type="button"
              className="ny-btn ny-btn--ghost"
              onClick={secondary.onClick}
            >
              {secondary.label}
            </button>
            {keyConfigured && (
              <span className="ny-welcome__status">
                <span className="dc-status-dot dc-status-dot--ok" />
                <span>API key paired</span>
              </span>
            )}
          </div>
        </div>
      </header>

      <ul className="ny-welcome__features" role="list">
        <FeatureCard
          tag="01"
          title="Lives in your Drive"
          body="No uploads, no third-party storage, no backend. Nyrima reads bytes from Drive in your browser; your library is exactly the folder you put it in."
        />
        <FeatureCard
          tag="02"
          title="Plays everything"
          body="MP4 and WebM stream natively. MKVs go through a progressive in-browser MSE remux, so they start playing while the rest of the file is still arriving."
        />
        <FeatureCard
          tag="03"
          title="Subtitles, sorted"
          body="Auto-matches sibling SRT, VTT, ASS, and SSA files by name, and surfaces embedded MKV tracks as they're decoded — including language labels in their native script."
        />
        <FeatureCard
          tag="04"
          title="Cinema chrome"
          body="A VLC-flavored HUD with monospace timecodes, sakura focus accents, keyboard shortcuts (Space · J · L · F · C · ,/.) and a kana eyebrow that knows whether you're paused or playing."
        />
      </ul>

      <ol className="ny-welcome__steps" aria-label="How to get started">
        <Step
          index="01"
          title="Create your Nyrima folder"
          body={
            <>
              Make a folder named <strong>“Nyrima”</strong> in Google Drive and
              drop your videos into it (subfolders welcome).
            </>
          }
        />
        <Step
          index="02"
          title="Share it publicly"
          body={
            <>
              Right-click → <em>Share</em>, then set{" "}
              <em>“Anyone with the link → Viewer”</em>. Nyrima never sees more
              than this.
            </>
          }
        />
        <Step
          index="03"
          title="Pair a Drive API key"
          body={
            <>
              Generate a free key in Google Cloud Console and paste it once.
              It stays on your machine.
            </>
          }
        />
      </ol>
    </section>
  );
}

function FeatureCard({
  tag,
  title,
  body,
}: {
  tag: string;
  title: string;
  body: string;
}) {
  return (
    <li className="ny-welcome__feature">
      <span className="ny-welcome__feature-tag">{tag}</span>
      <h3 className="ny-welcome__feature-title">{title}</h3>
      <p className="ny-welcome__feature-body">{body}</p>
    </li>
  );
}

function Step({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="ny-welcome__step">
      <span className="ny-welcome__step-index">{index}</span>
      <div className="ny-welcome__step-body">
        <span className="ny-welcome__step-title">{title}</span>
        <span className="ny-welcome__step-text">{body}</span>
      </div>
    </li>
  );
}
