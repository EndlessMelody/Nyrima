/**
 * Stub for `next/script`.
 *
 * Once UI's Schema (SEO) module imports `next/script`. We don't render any
 * SEO components in the extension, so a degraded `<script>` passthrough is
 * sufficient.
 */

import type { ScriptHTMLAttributes } from "react";

interface ScriptProps extends ScriptHTMLAttributes<HTMLScriptElement> {
  strategy?: "beforeInteractive" | "afterInteractive" | "lazyOnload" | "worker";
  onLoad?: () => void;
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

export default function Script(props: ScriptProps) {
  const { strategy, onLoad, onReady, onError, ...rest } = props;
  void strategy;
  void onLoad;
  void onReady;
  void onError;
  return <script {...rest} />;
}

export { Script };
