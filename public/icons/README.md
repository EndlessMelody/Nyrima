# Icons

`icon.svg` is the source. Chrome Extension manifest requires PNG icons at
16/32/48/128 px.

Generate them with any of:

```bash
# Using rsvg-convert (librsvg)
for size in 16 32 48 128; do
  rsvg-convert -w $size -h $size icon.svg -o icon-$size.png
done
```

```bash
# Using Inkscape CLI
for size in 16 32 48 128; do
  inkscape icon.svg --export-type=png --export-filename=icon-$size.png -w $size -h $size
done
```

```bash
# Using ImageMagick
for size in 16 32 48 128; do
  magick -background none -density 384 icon.svg -resize ${size}x${size} icon-$size.png
done
```

Until then the extension will load with a default placeholder icon — the
manifest references icon-{size}.png but Chrome falls back gracefully if any
are missing.
