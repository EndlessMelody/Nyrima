/**
 * NyrimaMark — brand icon wrapper with size variants.
 *
 * Resolves the brand icon through the web asset helper (served from /public),
 * replacing the former `chrome.runtime.getURL` extension lookup.
 *
 * Two variants:
 *   - "tile" (default): the square app-icon PNG (mark on the ink tile) with
 *     rounded corners — headers, cards, anywhere the mark sits as a chip.
 *   - "mark": the transparent SVG letterform only — for lockups on dark art
 *     backgrounds where the tile's baked-in ink square would read as a hard
 *     box against the scene.
 */

import { type ImgHTMLAttributes } from "react";
import { assetUrl } from "@/platform/asset-url";

const tileUrl = assetUrl("icons/app-icon.png");
const markUrl = assetUrl("icons/app-mark.svg");

export type MarkSize = "header" | "hero" | "splash";
export type MarkVariant = "tile" | "mark";

const SIZES: Record<MarkSize, number> = {
  header: 28,
  hero: 40,
  splash: 96,
};

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  size?: MarkSize;
  variant?: MarkVariant;
  /** Skip the inline px sizing so the caller's stylesheet controls the box
      (inline styles would otherwise beat any class rule). */
  fluid?: boolean;
}

export function NyrimaMark({
  size = "header",
  variant = "tile",
  fluid = false,
  style,
  ...rest
}: Props) {
  const px = SIZES[size];
  return (
    <img
      src={variant === "mark" ? markUrl : tileUrl}
      alt="Nyrima"
      width={px}
      height={px}
      draggable={false}
      style={{
        display: "block",
        flexShrink: 0,
        ...(fluid
          ? null
          : {
              width: px,
              height: px,
            }),
        ...(variant === "tile"
          ? { borderRadius: size === "splash" ? 20 : 8 }
          : null),
        ...style,
      }}
      {...rest}
    />
  );
}
