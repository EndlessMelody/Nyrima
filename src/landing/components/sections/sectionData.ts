export const repoUrl = "https://github.com/EndlessMelody/Nyrima";
export const posterBackgroundUrl = "/poster.png";
export const buildZipUrl =
  "https://github.com/EndlessMelody/Nyrima/releases/download/v0.1.0-beta/nyrima-v0.1.0-beta.zip";
export const releasesUrl = `${repoUrl}/releases`;

export const LOGIN_PATH = "/login";

/** Navigate within the web app (full navigation — intentionally leaves the
 *  marketing surface, unmounting the Three.js background and switching theme). */
export function goTo(path: string): void {
  if (typeof window !== "undefined") window.location.assign(path);
}

export const landingNavLinks = [
  { label: "Guide", href: "/guide", kind: "route" },
  { label: "FAQ", href: "/faq", kind: "route" },
  { label: "Contact", href: "/contact", kind: "route" },
  { label: "Changelog", href: releasesUrl, kind: "external" },
] as const;

export function openExternal(url: string) {
  window.open(url, "_blank", "noreferrer");
}
