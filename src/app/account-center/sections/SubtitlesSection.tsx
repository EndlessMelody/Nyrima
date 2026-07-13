/**
 * Subtitles — wraps the existing self-contained SubtitleConfigPanel (font
 * presets, size, weight, colors, outline, shadow, spacing, position).
 */

import { SubtitleConfigPanel } from "@app/components/SubtitleConfigPanel";
import type { SectionProps } from "../registry";

export function SubtitlesSection({ highlightSettingId: _ }: SectionProps) {
  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__card ny-ac__card--flush" data-setting-id="subtitles-typography">
        <SubtitleConfigPanel />
      </div>
    </div>
  );
}
