/**
 * OnboardingStrip — compact help/setup banner for returning users.
 *
 * Replaces the full WelcomeBlock once the user has libraries open. Keeps
 * setup, "Open a folder", and the three-step guide reachable without
 * dominating the lobby.
 */

import { useState } from "react";
import "./OnboardingStrip.scss";

interface Props {
  keyConfigured: boolean | null;
  rootPaired: boolean;
  onPickRoot: () => void;
  onOpenSetup: () => void;
}

export function OnboardingStrip({
  keyConfigured,
  rootPaired,
  onPickRoot,
  onOpenSetup,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className={`ny-onboard-strip${open ? " is-open" : ""}`}>
      <div className="ny-onboard-strip__row">
        <span className="ny-onboard-strip__eyebrow">
          ヘルプ · GETTING STARTED
        </span>
        <span className="ny-onboard-strip__tagline">
          New folder, new key, or need a refresher?
        </span>
        <div className="ny-onboard-strip__actions">
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={onPickRoot}
          >
            {rootPaired ? "Change Nyrima folder" : "Pair Nyrima folder"}
          </button>
          <button
            type="button"
            className="ny-btn ny-btn--ghost"
            onClick={onOpenSetup}
          >
            {keyConfigured ? "Manage access" : "Setup access"}
          </button>
          <button
            type="button"
            className="ny-onboard-strip__toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide guide" : "Show guide"}
            <Chevron open={open} />
          </button>
        </div>
      </div>

      {open && (
        <ol className="ny-onboard-strip__steps" aria-label="How to get started">
          <Step
            index="01"
            title="Create your Nyrima folder"
            body={
              <>
                Make a folder in Google Drive (any name works) and drop your
                videos in — subfolders welcome.
              </>
            }
          />
          <Step
            index="02"
            title="Share it publicly"
            body={
              <>
                Right-click → Share, then set "Anyone with the link → Viewer".
                Nyrima never sees more than this.
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
      )}
    </section>
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
    <li className="ny-onboard-strip__step">
      <span className="ny-onboard-strip__step-index">{index}</span>
      <div>
        <span className="ny-onboard-strip__step-title">{title}</span>
        <span className="ny-onboard-strip__step-text">{body}</span>
      </div>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      width="10"
      height="10"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 200ms ease",
      }}
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
