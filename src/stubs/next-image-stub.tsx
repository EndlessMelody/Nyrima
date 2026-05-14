/**
 * Stub for `next/image`.
 *
 * Once UI's <Media /> imports `next/image`. We don't ship the Next runtime,
 * so we degrade gracefully to a plain `<img>` element. Nyrima's player
 * doesn't depend on <Media />, but the module gets pulled in by the
 * components barrel export.
 */

import { forwardRef, type ImgHTMLAttributes } from "react";

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "loading" | "ref"> {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: unknown;
  loading?: "eager" | "lazy";
  sizes?: string;
  style?: React.CSSProperties;
  className?: string;
}

const Image = forwardRef<HTMLImageElement, ImageProps>(function NextImageStub(
  {
    src,
    alt,
    width,
    height,
    fill,
    priority,
    quality,
    placeholder,
    blurDataURL,
    unoptimized,
    loader,
    loading,
    ...rest
  },
  ref,
) {
  void priority;
  void quality;
  void placeholder;
  void blurDataURL;
  void unoptimized;
  void loader;
  const fillStyle: React.CSSProperties | undefined = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        ...rest.style,
      }
    : rest.style;
  return (
    <img
      {...rest}
      ref={ref}
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={loading ?? "lazy"}
      style={fillStyle}
    />
  );
});

export default Image;
export { Image };
