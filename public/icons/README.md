# Icons

`app-icon.png` is the general in-app/browser icon used by `NyrimaMark` and
HTML favicons.

`extension-icon.png` is the source for the Chrome extension icon. Chrome needs
fixed PNG sizes at 16/32/48/128 px, which are generated as:

```text
extension-icon-16.png
extension-icon-32.png
extension-icon-48.png
extension-icon-128.png
```

Run `npm run icons` after changing `extension-icon.png`.
