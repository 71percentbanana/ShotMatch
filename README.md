# ShotMatch web demo

A responsive, embeddable concept demo for **ShotMatch**, by **Chapati Soldiers**.

## Run locally

Requires Node.js 18 or newer. There are no packages to install.

```sh
git clone https://github.com/71percentbanana/ShotMatch.git shotmatch
cd shotmatch
node scripts/dev-server.mjs
```

Open the localhost URL printed by the server. It starts at port 4173 and tries the next available port if occupied. You can also pass a port: `node scripts/dev-server.mjs 4300`.

## Embed in a website

Host the folder's static client files on your website, then use an iframe:

```html
<iframe
  src="/shotmatch/index.html?embed=1"
  title="ShotMatch interactive demo"
  allow="camera; fullscreen"
  style="width:100%;height:1000px;border:0"
></iframe>
```

The embed query hides the full-page navigation. Set the height to suit your layout; the content remains scrollable on narrow screens. Camera access requires HTTPS or localhost, permission from the visitor, and a compatible iframe Permissions Policy. A cross-origin host must also permit the iframe's origin in its camera policy. Public hosting is not configured or deployed by this project.

## What works

- Three bundled demo scenes and locally imported reference/photos (JPG, PNG, WebP, AVIF; 20 MB and 40 MP limits).
- Canvas-based framing: drag, keyboard arrows, nudge controls, zoom, mirror and composition grid.
- Brightness, contrast, saturation and warmth controls, with the same renderer for preview and export.
- Reference palette extraction, image-statistics light readings and bounded color suggestions.
- A camera mode through `getUserMedia`, requested only after the visitor selects Camera.
- Capture, original/edited comparison, JPEG downloads and an in-memory session gallery of up to eight shots.
- Responsive layout, keyboard-accessible controls, reduced-motion support and labeled error states.

## Concept boundaries

**No trained AI or subject/pose detection runs in this demo.** The three built-in scenes have manually specified bounding boxes. Framing feedback and the alignment percentage are calculated from the demo image's pan/zoom relative to its preset framing. They are not detection confidence, aesthetic scores or evidence of an implemented Android model. Uploading a different reference or photo, or enabling the camera, switches to manual framing and disables preset alignment.

Color suggestions compare small-image luminance, saturation, contrast and relative red/blue balance. They are visual starting points, not physical lighting reconstruction or guaranteed style matches. Brightness is a software edit, not hardware exposure compensation. Camera ISO, shutter, exposure and white balance are not controlled here. Browser color behavior may vary. Warmth uses a soft-light tint, not a Kelvin adjustment.

Demo reference images have a small predefined color treatment to make the reference/look workflow visible. The sample photographs were generated for the ShotMatch concept deck. User images are never uploaded to a backend; the client has no external network dependencies or analytics. No Pinterest integration or scraping is implemented. Visitors can import a photo they have saved and are permitted to use.

Gallery images live only in memory and are cleared on reload. Downloaded originals preserve the captured framing before color adjustments; they are not a lossless copy of an imported source file. Exports are 1600x1200 JPEG. Keep the source file for full original quality.

## Files

- `index.html`: accessible app structure and review/gallery dialogs.
- `styles.css`: responsive ShotMatch styling.
- `js/app.js`: local state, image pipeline, guidance simulation and browser camera.
- `scripts/dev-server.mjs`: dependency-free development server, restricted to loopback.
- `assets/`: generated sample photos, extracted from the team's concept gallery.
- `vendor/lucide.min.js`: bundled Lucide icons; license in `vendor/LUCIDE-LICENSE`.

Team: Alan James, Anuroop Phukan and Ishaan Sridharan.

## Android app

A Capacitor-based Android prototype lives in [`mobile/`](mobile/README.md), with build and phone-install instructions.
