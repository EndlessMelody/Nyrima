/**
 * Stub for `next/link`.
 *
 * Once UI's <ElementType /> and <Logo /> import `next/link` so they can use
 * Next.js client-side navigation. In a Chrome Extension (Vite) build there is
 * no Next.js runtime, but the components are still re-exported through
 * `dist/components/index.js`, so Rollup pulls them in even when we never
 * render them.
 *
 * This stub renders a plain `<a>` element when the component is used and is
 * otherwise inert — enough to satisfy the import without breaking the page.
 */

import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function NextLinkStub(
  { href, children, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, ...rest },
  ref,
) {
  // Discard the Next.js-specific props; they're meaningless without a Next router.
  void prefetch;
  void replace;
  void scroll;
  void shallow;
  void passHref;
  void legacyBehavior;
  void locale;
  return (
    <a {...rest} href={href} ref={ref}>
      {children}
    </a>
  );
});

export default Link;
export { Link };
