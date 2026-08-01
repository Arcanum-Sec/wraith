# vendor/

Optional self-hosted libraries, served by WRAITH at `/vendor/...`.

## html2canvas (offline screenshots for the Page Capture module)

The **Page Capture** module screenshots the victim page with html2canvas. By
default it loads from a CDN. For an **offline / air-gapped lab**, download the
library once and drop it here so the hook pulls it from the WRAITH server
instead of the internet:

```
public/vendor/html2canvas.min.js
```

Get it from https://github.com/niklasvh/html2canvas/releases (the `dist/`
`html2canvas.min.js`) or any npm mirror. The capture module tries
`/vendor/html2canvas.min.js` first, then falls back to the CDN, then degrades
gracefully (reports "screenshot unavailable") if neither is reachable.
