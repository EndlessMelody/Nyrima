/**
 * Stub for `next/navigation`.
 *
 * Provides no-op equivalents of the hooks and helpers Once UI's Kbar /
 * MegaMenu modules expect. None of those modules are rendered by Drive
 * Cinema, so these implementations only have to be safe at import time.
 */

const router = {
  push: (_url: string) => {},
  replace: (_url: string) => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: (_url: string) => {},
};

export function useRouter() {
  return router;
}

export function usePathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.hash.replace(/^#/, "") || window.location.pathname;
}

export function useSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function useParams(): Record<string, string | string[]> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(_url: string): never {
  throw new Error("redirect() is a no-op in the Nyrima build.");
}

export function notFound(): never {
  throw new Error("notFound() is a no-op in the Nyrima build.");
}

export const ReadonlyURLSearchParams = URLSearchParams;
