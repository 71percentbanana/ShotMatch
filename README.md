# ShotMatch – Responsive Concept Demo

A lightweight, embeddable interactive demo by Chapati Soldiers (Alan James, Anuroop Phukan, Ishaan Sridharan).

## Getting Started Locally

**Requirements:** Node.js 18+. No dependencies to install.

```bash
git clone https://github.com/71percentbanana/ShotMatch.git shotmatch
cd shotmatch
node scripts/dev-server.mjs
```

The server will print a localhost URL (starting at port 4173; automatically tries the next available port if it's in use). You can specify a port manually:

```bash
node scripts/dev-server.mjs 4300
```

## Embedding on Your Website

Host the project's client files and embed via iframe:

```html
<iframe
  src="/shotmatch/index.html?embed=1"
  title="ShotMatch interactive demo"
  allow="camera; fullscreen"
  style="width:100%;height:1000px;border:0"
></iframe>
```

The `embed=1` parameter hides full-page navigation. Adjust height to fit your layout; the content remains scrollable on mobile. 

**Camera permissions:** Requires HTTPS (or localhost), visitor permission, and compatible iframe permissions policy. Cross-origin hosts must allow the iframe's origin in their camera policy. This project doesn't include public hosting or deployment.

## What's Included

- **Three demo scenes** plus local photo uploads (JPG, PNG, WebP, AVIF; 20 MB and 40 MP max)
- **Canvas framing tools:** drag, arrow keys, zoom, mirror, composition grid, nudge controls
- **Image adjustments:** brightness, contrast, saturation, warmth
- **Color tools:** palette extraction from references, light metering, bounded color suggestions
- **Camera capture** via `getUserMedia` (only requested when Camera is selected)
- **Output options:** compare original/edited, download JPEG, in-memory gallery (up to 8 shots)
- **Accessibility:** responsive layout, keyboard controls, reduced-motion support, clear error states

## What This Demo Does *Not* Do

This is a manual framing tool, not an AI assistant:

- **No object detection.** Built-in scenes use preset bounding boxes; framing feedback comes from manual pan/zoom against those presets, not confidence scores
- **No aesthetic scoring.** Alignment percentages reflect framing, not automated aesthetics or model predictions
- **No hardware control.** Brightness is a software filter; camera ISO, shutter, white balance, and exposure remain in your device's hands
- **No Kelvin math.** Warmth is a soft-light tint overlay
- **No cloud processing.** All work happens client-side; no server dependencies, uploads, or analytics
- **No Pinterest scraping** or external integrations

Color suggestions are visual starting points based on luminance, saturation, contrast, and color balance—not physical lighting reconstruction.

Demo references include a subtle preset color treatment to show the reference/look workflow. Sample photos were generated for the concept deck. Your uploaded photos never leave your browser; gallery images are cleared on reload. Downloaded originals preserve your framing *before* color adjustments (for full quality, keep the source file). Exports are 1600×1200 JPEG.

## Project Structure

- `index.html` – App markup and dialogs
- `styles.css` – Responsive styling
- `js/app.js` – State, image pipeline, guidance, and browser camera
- `scripts/dev-server.mjs` – Zero-dependency dev server (localhost only)
- `assets/` – Sample photos
- `vendor/lucide.min.js` – Bundled icons (see `vendor/LUCIDE-LICENSE`)

## Android App

A Capacitor-based prototype is in the `mobile/` folder with build and installation instructions.
