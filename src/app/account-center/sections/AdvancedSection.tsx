/**
 * Advanced — BYOK API credentials (the optional fallback path behind OAuth)
 * and the About block.
 */

import { useEffect, useState } from "react";
import { ApiConfigPanel } from "@app/components/ApiConfigPanel";
import { hasApiKey } from "@app/services/api-key";
import { getUserProfile } from "@app/services/user-profile";
import type { SectionProps } from "../registry";

export function AdvancedSection({ highlightSettingId: _ }: SectionProps) {
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [oauthActive, setOauthActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hasApiKey().then((v) => {
      if (!cancelled) setKeyConfigured(v);
    });
    void getUserProfile().then((p) => {
      if (!cancelled) setOauthActive(!!p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ny-ac__section-body">
      <div className="ny-ac__card ny-ac__card--flush" data-setting-id="advanced-api">
        <ApiConfigPanel />
      </div>

      <div className="ny-ac__card" data-setting-id="advanced-about">
        <div className="ny-ac__about-row">
          <span className="ny-ac__about-label">Nyrima</span>
          <span className="ny-ac__about-value">v0.0.1</span>
        </div>
        <div className="ny-ac__about-row">
          <span className="ny-ac__about-label">Drive access</span>
          <span className="ny-ac__about-value ny-ac__about-value--status">
            {oauthActive
              ? "OAuth connected"
              : keyConfigured
                ? "API key configured"
                : "Not configured"}
          </span>
        </div>
      </div>
    </div>
  );
}
