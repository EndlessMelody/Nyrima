/**
 * CaptureCard — screenshot + scene-bookmark actions, shown in the title row
 * directly under the episode list. Pulled out of the old control strip so the
 * capture tools sit next to the title instead of in the playback row.
 */

import cn from "classnames";
import { Camera, Bookmark } from "lucide-react";

interface Props {
  onScreenshot: () => void;
  screenshotStatus: "idle" | "saved" | "blocked" | "error";
  onBookmark: () => void;
  bookmarkSaved: boolean;
}

export function CaptureCard({
  onScreenshot,
  screenshotStatus,
  onBookmark,
  bookmarkSaved,
}: Props) {
  return (
    <section className="watch-capture" aria-label="Capture">
      <span className="watch-capture__label">
        <Camera aria-hidden="true" />
        Capture
      </span>
      <div className="watch-capture__buttons">
        <button
          type="button"
          className="watch-action ny-focusable"
          onClick={onScreenshot}
          disabled={screenshotStatus !== "idle"}
          title={
            screenshotStatus === "blocked"
              ? "Browser blocked the capture (cross-origin video)"
              : "Save the current frame as a PNG"
          }
        >
          <Camera aria-hidden="true" />
          {screenshotStatus === "saved"
            ? "Saved ✓"
            : screenshotStatus === "blocked"
              ? "Blocked"
              : screenshotStatus === "error"
                ? "Failed"
                : "Screenshot"}
        </button>
        <button
          type="button"
          className={cn("watch-action ny-focusable", {
            "is-active": bookmarkSaved,
          })}
          onClick={onBookmark}
          title="Bookmark the current moment"
        >
          <Bookmark aria-hidden="true" />
          {bookmarkSaved ? "Saved ✓" : "Bookmark"}
        </button>
      </div>
    </section>
  );
}
