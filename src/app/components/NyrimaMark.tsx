/**
 * NyrimaMark — brand icon wrapper with size variants.
 *
 * Uses the extension-bundled app-icon.png so it renders consistently across
 * chrome-extension:// pages and (fallback) dev-server contexts.
 */

import { type ImgHTMLAttributes } from "react";

const iconUrl =
  typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("icons/app-icon.png")
    : "/icons/app-icon.png";

export type MarkSize = "header" | "hero" | "splash";

const SIZES: Record<MarkSize, number> = {
  header: 28,
  hero: 40,
  splash: 96,
};

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  size?: MarkSize;
}

export function NyrimaMark({ size = "header", style, ...rest }: Props) {
  const px = SIZES[size];
  return (
    <img
      src={iconUrl}
      alt="Nyrima"
      width={px}
      height={px}
      draggable={false}
      style={{
        display: "block",
        width: px,
        height: px,
        borderRadius: size === "splash" ? 20 : 8,
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    />
  );
}
