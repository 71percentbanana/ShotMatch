'use strict';

const $ = id => document.getElementById(id);
const icons = () => window.lucide.createIcons();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const settingsKeys = ['brightness', 'contrast', 'saturation', 'warmth'];
const neutral = () => ({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });
const presets = {
  'still-life': { name: 'Window light', box: { x: .31, y: .10, w: .40, h: .81 }, look: { brightness: 4, contrast: 6, saturation: 10, warmth: 7 } },
  portrait: { name: 'Everyday portrait', box: { x: .15, y: .08, w: .55, h: .90 }, look: { brightness: 3, contrast: 4, saturation: -6, warmth: 5 } },
  coast: { name: 'Last light', box: { x: .27, y: .22, w: .47, h: .48 }, look: { brightness: -3, contrast: 8, saturation: 9, warmth: 6 } }
};
const state = { mode: 'demo', sceneId: 'still-life', referencePreset: 'still-life', source: null, reference: null, referenceStats: null, panX: .11, panY: -.018, zoom: 1.18, mirror: false, grid: true, settings: neutral(), captures: [], currentCapture: null };
let stream = null;
let cameraAnimation = 0;
let renderPending = false;
let sourceToken = 0;
let referenceToken = 0;
let alignmentToken = 0;
let toastTimer;
let lastReading = 0;
let captureSequence = 0;
let sceneObjectUrl = null;
let referenceObjectUrl = null;
const imageCache = new Map();
const stage = $('stage');
const canvas = $('preview');
const context = canvas.getContext('2d', { alpha: false });
const video = $('camera-video');
const measurement = document.createElement('canvas');
measurement.width = 80;
measurement.height = 60;
const measurementContext = measurement.getContext('2d', { willReadFrequently: true });

if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed');
icons();
$('shutter').disabled = true;

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3300);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened. Try a JPG, PNG or WebP file.'));
    image.src = url;
  });
}

function sourceDimensions(source) {
  return { width: source.videoWidth || source.naturalWidth || source.width, height: source.videoHeight || source.naturalHeight || source.height };
}

function imageGeometry(source, width, height, view) {
  const size = sourceDimensions(source);
  const scale = Math.max(width / size.width, height / size.height) * view.zoom;
  const drawnWidth = size.width * scale;
  const drawnHeight = size.height * scale;
  return { width: drawnWidth, height: drawnHeight, x: (width - drawnWidth) / 2 + view.panX * width, y: (height - drawnHeight) / 2 + view.panY * height };
}

function constrainFraming() {
  if (!state.source) return;
  const geometry = imageGeometry(state.source, 4, 3, { zoom: state.zoom, panX: 0, panY: 0 });
  state.panX = clamp(state.panX, -(geometry.width - 4) / 8, (geometry.width - 4) / 8);
  state.panY = clamp(state.panY, -(geometry.height - 3) / 6, (geometry.height - 3) / 6);
}

// Preview, capture and comparison all use this same rendering pipeline.
function drawPhoto(ctx, source, width, height, view, settings) {
  const box = imageGeometry(source, width, height, view);
  ctx.save();
  ctx.fillStyle = '#26362e';
  ctx.fillRect(0, 0, width, height);
  if (view.mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.filter = `brightness(${1 + settings.brightness / 100}) contrast(${1 + settings.contrast / 100}) saturate(${1 + settings.saturation / 100})`;
  ctx.drawImage(source, box.x, box.y, box.width, box.height);
  ctx.restore();
  if (settings.warmth) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.abs(settings.warmth) / 100;
    ctx.fillStyle = settings.warmth > 0 ? '#ef9c48' : '#4a9ade';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function measure(source, view = { zoom: 1, panX: 0, panY: 0, mirror: false }, settings = neutral()) {
  drawPhoto(measurementContext, source, 80, 60, view, settings);
  const pixels = measurementContext.getImageData(0, 0, 80, 60).data;
  let luminance = 0, luminance2 = 0, saturation = 0, red = 0, blue = 0, clipped = 0;
  const bins = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const light = .2126 * r + .7152 * g + .0722 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    luminance += light; luminance2 += light * light;
    saturation += max ? (max - min) / max : 0;
    red += r; blue += b;
    if (light >= 250) clipped++;
    const key = [r, g, b].map(value => Math.min(240, Math.floor(value / 32) * 32 + 16)).join(',');
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const count = pixels.length / 4;
  const mean = luminance / count;
  return { brightness: mean, deviation: Math.sqrt(Math.max(0, luminance2 / count - mean * mean)), saturation: saturation / count, warmth: (red - blue) / count, clipping: 100 * clipped / count, colors: [...bins].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([color]) => `rgb(${color})`) };
}

function updatePalette() {
  $('palette').replaceChildren();
  state.referenceStats.colors.forEach(color => {
    const swatch = document.createElement('span');
    swatch.style.backgroundColor = color;
    swatch.title = color;
    $('palette').append(swatch);
  });
}

function canMatch() { return state.mode === 'demo' && state.sceneId && state.referencePreset === state.sceneId; }

function placeBox(element, box, source, view, width, height) {
  const image = imageGeometry(source, width, height, view);
  let x = image.x + box.x * image.width;
  const y = image.y + box.y * image.height;
  const w = box.w * image.width;
  if (view.mirror) x = width - x - w;
  element.style.left = `${x / width * 100}%`;
  element.style.top = `${y / height * 100}%`;
  element.style.width = `${w / width * 100}%`;
  element.style.height = `${box.h * image.height / height * 100}%`;
}

function setCue(title, detail, overlay, symbol = 'move-left') {
  $('cue-title').textContent = title;
  $('cue-detail').textContent = detail;
  if ($('stage-cue').dataset.cue !== title) {
    $('stage-cue').replaceChildren();
    const icon = document.createElement('i');
    icon.dataset.lucide = symbol;
    const label = document.createElement('span');
    label.textContent = overlay;
    $('stage-cue').append(icon, label);
    $('stage-cue').dataset.cue = title;
    icons();
  }
}

function updateGuidance() {
  const matchable = canMatch();
  $('align-button').disabled = !matchable;
  $('subject-box').hidden = !matchable;
  $('guide-mode').textContent = matchable ? 'PRESET FRAMING' : 'MANUAL REFERENCE';
  $('guidance-label').textContent = matchable ? 'Preset framing / simulated tracking' : 'Manual guide / no subject detection';
  if (!matchable) {
    $('alignment-value').textContent = 'Manual';
    $('alignment-fill').style.width = '0%';
    setCue('Your eye, your frame.', 'Subject tracking is not connected in this web demo.', 'Frame your subject against the reference', 'scan-line');
    Object.assign($('target-box').style, { left: '24%', top: '16%', width: '52%', height: '68%' });
    return;
  }
  const error = Math.hypot(state.panX, state.panY) * 2.1 + (state.zoom - 1) * .75;
  const score = Math.round(clamp(100 - error * 100, 0, 100));
  $('alignment-value').textContent = `${score}%`;
  $('alignment-fill').style.width = `${score}%`;
  const width = stage.clientWidth, height = stage.clientHeight;
  const box = presets[state.sceneId].box;
  placeBox($('target-box'), box, state.source, { panX: 0, panY: 0, zoom: 1, mirror: state.mirror }, width, height);
  placeBox($('subject-box'), box, state.source, state, width, height);
  const horizontal = state.mirror ? -state.panX : state.panX;
  if (Math.abs(horizontal) > .022) {
    const side = horizontal > 0 ? 'left' : 'right';
    setCue(`A little to the ${side}.`, 'Bring the subject toward the reference outline.', `Bring the subject a little ${side}`, `move-${side}`);
  } else if (state.zoom > 1.035) {
    setCue('Give it some room.', 'The subject is larger than in the preset reference.', 'Zoom out a little', 'minimize-2');
  } else if (Math.abs(state.panY) > .018) {
    setCue('Level the framing.', 'Bring the subject toward the reference height.', 'Adjust the vertical framing', 'move-vertical');
  } else {
    setCue('That is the frame.', 'The preset guides line up. Make the look your own.', 'Framing aligned. Ready when you are.', 'check');
  }
}

function updateReadings(force = false) {
  if (!state.source || (!force && performance.now() - lastReading < 200)) return;
  lastReading = performance.now();
  const stats = measure(state.source, state, state.settings);
  $('light-value').textContent = stats.clipping > 6 ? 'Bright highlights' : stats.brightness < 72 ? 'Low light' : stats.brightness > 195 ? 'Very bright' : 'Balanced';
  $('clipping-value').textContent = `${stats.clipping.toFixed(1)}%`;
}

function render() {
  renderPending = false;
  if (!state.source || !sourceDimensions(state.source).width) return;
  constrainFraming();
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.round(stage.clientWidth * ratio), height = Math.round(stage.clientHeight * ratio);
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  drawPhoto(context, state.source, width, height, state, state.settings);
  $('composition-grid').hidden = !state.grid;
  updateGuidance();
  updateReadings();
  $('shutter').disabled = false;
}

function scheduleRender() { if (!renderPending) { renderPending = true; requestAnimationFrame(render); } }

function rangePaint(input) {
  input.style.setProperty('--progress', `${100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))}%`);
}

function syncControls() {
  for (const key of settingsKeys) {
    $(key).value = state.settings[key];
    $(`${key}-value`).textContent = state.settings[key] > 0 ? `+${state.settings[key]}` : state.settings[key];
    rangePaint($(key));
  }
  $('zoom').value = state.zoom;
  $('zoom-value').textContent = `${state.zoom.toFixed(2)}x`;
  rangePaint($('zoom'));
  $('mirror-toggle').classList.toggle('active', state.mirror);
  $('mirror-toggle').setAttribute('aria-pressed', state.mirror);
}

function updateModes() {
  for (const mode of ['demo', 'camera']) {
    $(`${mode}-mode`).classList.toggle('selected', state.mode === mode || (mode === 'demo' && state.mode === 'photo'));
    $(`${mode}-mode`).setAttribute('aria-pressed', state.mode === mode || (mode === 'demo' && state.mode === 'photo'));
  }
  $('source-label').lastChild.textContent = state.mode === 'camera' ? ' CAMERA LIVE' : state.mode === 'photo' ? ' YOUR PHOTO' : ' DEMO SCENE';
  document.querySelectorAll('[data-scene]').forEach(button => {
    const active = state.mode === 'demo' && button.dataset.scene === state.sceneId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
}

function stopCamera() {
  cancelAnimationFrame(cameraAnimation);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
}

async function selectPreset(id) {
  const token = ++sourceToken;
  const refToken = ++referenceToken;
  alignmentToken++;
  $('camera-error').hidden = true;
  try {
    if (!imageCache.has(id)) imageCache.set(id, loadImage(`./assets/${id}.jpg`));
    const image = await imageCache.get(id);
    if (token !== sourceToken) return;
    stopCamera();
    state.source = image;
    state.mode = 'demo';
    state.sceneId = id;
    state.panX = id === 'portrait' ? .06 : .08;
    state.panY = -.018;
    state.zoom = 1.12;
    state.mirror = false;
    state.settings = neutral();
    if (sceneObjectUrl) { URL.revokeObjectURL(sceneObjectUrl); sceneObjectUrl = null; }
    const refCanvas = document.createElement('canvas');
    refCanvas.width = 800; refCanvas.height = 600;
    drawPhoto(refCanvas.getContext('2d'), image, 800, 600, { zoom: 1, panX: 0, panY: 0, mirror: false }, presets[id].look);
    const reference = await loadImage(refCanvas.toDataURL('image/jpeg', .94));
    if (token !== sourceToken) return;
    if (refToken === referenceToken) {
      if (referenceObjectUrl) { URL.revokeObjectURL(referenceObjectUrl); referenceObjectUrl = null; }
      state.reference = reference;
      state.referencePreset = id;
      state.referenceStats = measure(reference);
      $('reference-image').src = reference.src;
      $('reference-name').textContent = presets[id].name;
      updatePalette();
    }
    $('look-status').textContent = 'Original colors';
    syncControls(); updateModes(); scheduleRender();
  } catch (error) { notify(error.message); }
}

async function openFile(file, role) {
  if (!file) return;
  if (!/\.(jpe?g|png|webp|avif)$/i.test(file.name) || (file.type && !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type))) { notify('Choose a JPG, PNG, WebP or AVIF image.'); return; }
  if (file.size > 20 * 1024 * 1024) { notify('This file is too large. Choose an image under 20 MB.'); return; }
  const token = role === 'reference' ? ++referenceToken : ++sourceToken;
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (token !== (role === 'reference' ? referenceToken : sourceToken)) { URL.revokeObjectURL(url); return; }
    if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('Choose an image smaller than 40 megapixels.');
    alignmentToken++;
    if (role === 'reference') {
      if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
      referenceObjectUrl = url;
      state.reference = image;
      state.referencePreset = null;
      state.referenceStats = measure(image);
      $('reference-image').src = url;
      $('reference-name').textContent = file.name;
      updatePalette();
      notify('Reference imported locally.');
    } else {
      stopCamera();
      if (sceneObjectUrl) URL.revokeObjectURL(sceneObjectUrl);
      sceneObjectUrl = url;
      state.source = image;
      state.mode = 'photo'; state.sceneId = null;
      state.panX = 0; state.panY = 0; state.zoom = 1; state.mirror = false;
      state.settings = neutral();
      $('look-status').textContent = 'Original colors';
      $('camera-error').hidden = true;
      updateModes(); syncControls();
      notify('Photo opened.');
    }
    scheduleRender();
  } catch (error) { URL.revokeObjectURL(url); notify(error.message); }
}

async function startCamera() {
  if (state.mode === 'camera') return;
  if (!navigator.mediaDevices?.getUserMedia) { $('camera-error').hidden = false; $('camera-error').textContent = 'Camera access needs localhost or HTTPS. You can still use demo scenes or open a photo.'; return; }
  const token = ++sourceToken;
  $('camera-mode').disabled = true;
  $('camera-error').hidden = true;
  let pendingStream;
  try {
    pendingStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    if (token !== sourceToken) { pendingStream.getTracks().forEach(track => track.stop()); return; }
    stopCamera();
    stream = pendingStream;
    video.srcObject = stream;
    await video.play();
    if (token !== sourceToken) { pendingStream.getTracks().forEach(track => track.stop()); return; }
    alignmentToken++;
    state.source = video;
    state.mode = 'camera'; state.sceneId = null;
    state.panX = 0; state.panY = 0; state.zoom = 1; state.mirror = false;
    state.settings = neutral();
    $('look-status').textContent = 'Original colors';
    syncControls(); updateModes();
    let lastFrame = 0;
    const tick = time => {
      if (state.mode !== 'camera') return;
      if (!document.hidden && time - lastFrame > 70) { lastFrame = time; scheduleRender(); }
      cameraAnimation = requestAnimationFrame(tick);
    };
    cameraAnimation = requestAnimationFrame(tick);
    notify('Camera connected. Subject tracking remains a concept feature.');
  } catch (error) {
    pendingStream?.getTracks().forEach(track => track.stop());
    if (token !== sourceToken) return;
    $('camera-error').textContent = error.name === 'NotAllowedError' ? 'Camera permission was not granted. Use a demo scene or open a photo instead.' : error.name === 'NotFoundError' ? 'No camera was found. Use a demo scene or open a photo instead.' : error.name === 'NotSupportedError' ? 'Camera capture is unavailable in this browser. You can still open a photo or use the demo scenes.' : 'The camera could not start. Check that another app is not using it.';
    $('camera-error').hidden = false;
  } finally { $('camera-mode').disabled = false; }
}

function matchFraming() {
  if (!canMatch()) return;
  const token = ++alignmentToken;
  const initial = { panX: state.panX, panY: state.panY, zoom: state.zoom };
  const start = performance.now();
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 550;
  const step = time => {
    if (token !== alignmentToken) return;
    const progress = clamp((time - start) / duration, 0, 1);
    const remaining = (1 - progress) ** 3;
    state.panX = initial.panX * remaining;
    state.panY = initial.panY * remaining;
    state.zoom = 1 + (initial.zoom - 1) * remaining;
    syncControls(); scheduleRender();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function suggestLook() {
  if (!state.source || !state.referenceStats) return;
  const current = measure(state.source, state);
  const target = state.referenceStats;
  // Bounded image-statistics heuristic, not aesthetic scoring or a vision model.
  state.settings = {
    brightness: Math.round(clamp((target.brightness - current.brightness) / 2.1, -25, 25)),
    contrast: Math.round(clamp((target.deviation / Math.max(current.deviation, 15) - 1) * 55, -18, 20)),
    saturation: Math.round(clamp((target.saturation - current.saturation) * 95, -30, 30)),
    warmth: Math.round(clamp((target.warmth - current.warmth) * .4, -22, 22))
  };
  syncControls(); scheduleRender();
  $('look-status').textContent = 'Reference-statistics suggestion. Fine-tune to taste.';
  notify('A starting look, based on reference colors.');
}

function capturePhoto() {
  if (!state.source) return;
  const shot = document.createElement('canvas');
  shot.width = 1600; shot.height = 1200;
  const ctx = shot.getContext('2d');
  drawPhoto(ctx, state.source, 1600, 1200, state, neutral());
  const original = shot.toDataURL('image/jpeg', .94);
  drawPhoto(ctx, state.source, 1600, 1200, state, state.settings);
  const edited = shot.toDataURL('image/jpeg', .94);
  const capture = { id: ++captureSequence, original, edited, date: new Date(), settings: { ...state.settings } };
  state.captures.unshift(capture);
  if (state.captures.length > 8) { state.captures.pop(); notify('The gallery keeps your latest 8 shots. Download photos to keep them.'); }
  $('capture-flash').classList.remove('fire');
  void $('capture-flash').offsetWidth;
  $('capture-flash').classList.add('fire');
  updateGallery();
  openReview(capture);
}

function openReview(capture) {
  state.currentCapture = capture;
  $('review-before').src = capture.original;
  $('review-after').src = capture.edited;
  $('comparison-range').value = 50;
  updateComparison();
  if ($('gallery-dialog').open) $('gallery-dialog').close();
  if (!$('review-dialog').open) $('review-dialog').showModal();
}

function updateComparison() {
  const value = $('comparison-range').value;
  $('review-after-wrap').style.clipPath = `inset(0 0 0 ${value}%)`;
  $('comparison-divider').style.left = `${value}%`;
  rangePaint($('comparison-range'));
}

function downloadCapture(original) {
  if (!state.currentCapture) return;
  const link = document.createElement('a');
  link.href = original ? state.currentCapture.original : state.currentCapture.edited;
  link.download = `shotmatch-${String(state.currentCapture.id).padStart(2, '0')}-${original ? 'original' : 'look'}.jpg`;
  document.body.append(link); link.click(); link.remove();
}

function updateGallery() {
  $('gallery-count').textContent = state.captures.length;
  $('gallery-total').textContent = `${state.captures.length} ${state.captures.length === 1 ? 'photo' : 'photos'} / session`;
  $('gallery-empty').hidden = state.captures.length > 0;
  $('clear-gallery').disabled = state.captures.length === 0;
  $('last-capture').disabled = state.captures.length === 0;
  $('last-capture').replaceChildren();
  $('gallery-grid').replaceChildren();
  if (state.captures.length) {
    const thumbnail = document.createElement('img'); thumbnail.src = state.captures[0].edited; thumbnail.alt = 'Latest capture';
    $('last-capture').append(thumbnail);
  } else {
    const icon = document.createElement('i'); icon.dataset.lucide = 'image'; $('last-capture').append(icon);
  }
  state.captures.forEach(capture => {
    const button = document.createElement('button'); button.className = 'gallery-item';
    const image = document.createElement('img'); image.src = capture.edited; image.alt = `Capture ${capture.id}`;
    const label = document.createElement('span'); label.textContent = `Shot ${String(capture.id).padStart(2, '0')} / ${capture.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    button.append(image, label); button.addEventListener('click', () => openReview(capture));
    $('gallery-grid').append(button);
  });
  icons();
}

function nudge(direction) {
  alignmentToken++;
  const amount = .018;
  if (direction === 'left') state.panX -= state.mirror ? -amount : amount;
  if (direction === 'right') state.panX += state.mirror ? -amount : amount;
  if (direction === 'up') state.panY -= amount;
  if (direction === 'down') state.panY += amount;
  scheduleRender();
}

document.querySelectorAll('[data-scene]').forEach(button => button.addEventListener('click', () => selectPreset(button.dataset.scene)));
document.querySelectorAll('[data-nudge]').forEach(button => button.addEventListener('click', () => nudge(button.dataset.nudge)));
$('reference-import').addEventListener('click', () => $('reference-file').click());
$('reference-replace').addEventListener('click', () => $('reference-file').click());
$('scene-import').addEventListener('click', () => $('scene-file').click());
for (const role of ['reference', 'scene']) $(role + '-file').addEventListener('change', event => { openFile(event.target.files[0], role); event.target.value = ''; });
for (const type of ['dragenter', 'dragover']) $('reference-drop').addEventListener(type, event => { event.preventDefault(); $('reference-drop').classList.add('drag-over'); });
$('reference-drop').addEventListener('dragleave', () => $('reference-drop').classList.remove('drag-over'));
$('reference-drop').addEventListener('drop', event => { event.preventDefault(); $('reference-drop').classList.remove('drag-over'); openFile(event.dataTransfer.files[0], 'reference'); });
$('demo-mode').addEventListener('click', () => selectPreset(state.sceneId || 'still-life'));
$('camera-mode').addEventListener('click', startCamera);
$('align-button').addEventListener('click', matchFraming);
$('suggest-look').addEventListener('click', suggestLook);
$('look-reset').addEventListener('click', () => { state.settings = neutral(); syncControls(); scheduleRender(); $('look-status').textContent = 'Original colors'; });
$('framing-reset').addEventListener('click', () => { alignmentToken++; state.panX = 0; state.panY = 0; state.zoom = 1; syncControls(); scheduleRender(); });
$('zoom').addEventListener('input', event => { alignmentToken++; state.zoom = Number(event.target.value); syncControls(); scheduleRender(); });
for (const key of settingsKeys) $(key).addEventListener('input', event => { state.settings[key] = Number(event.target.value); syncControls(); scheduleRender(); $('look-status').textContent = 'Your custom look'; });
$('grid-toggle').addEventListener('click', () => { state.grid = !state.grid; $('grid-toggle').classList.toggle('active', state.grid); $('grid-toggle').setAttribute('aria-pressed', state.grid); scheduleRender(); });
$('mirror-toggle').addEventListener('click', () => { state.mirror = !state.mirror; syncControls(); scheduleRender(); });
$('fullscreen-toggle').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if ($('preview-shell').requestFullscreen) await $('preview-shell').requestFullscreen(); else notify('Fullscreen is not available in this browser.'); } catch { notify('Fullscreen is not available in this browser.'); } });
$('shutter').addEventListener('click', capturePhoto);
$('fullscreen-exit').addEventListener('click', () => document.exitFullscreen().catch(() => notify('Use your browser fullscreen control to exit.')));
$('review-close').addEventListener('click', () => $('review-dialog').close());
$('download-original').addEventListener('click', () => downloadCapture(true));
$('download-edited').addEventListener('click', () => downloadCapture(false));
$('comparison-range').addEventListener('input', updateComparison);
$('last-capture').addEventListener('click', () => state.captures[0] && openReview(state.captures[0]));
$('gallery-open').addEventListener('click', () => { updateGallery(); $('gallery-dialog').showModal(); });
$('gallery-close').addEventListener('click', () => $('gallery-dialog').close());
$('clear-gallery').addEventListener('click', () => { state.captures = []; state.currentCapture = null; $('review-before').removeAttribute('src'); $('review-after').removeAttribute('src'); updateGallery(); notify('Session gallery cleared. Downloaded files are unchanged.'); });

let drag = null;
stage.addEventListener('pointerdown', event => {
  if (event.target.closest('button')) return;
  alignmentToken++;
  drag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', event => {
  if (!drag) return;
  state.panX = drag.panX + (event.clientX - drag.x) / stage.clientWidth * (state.mirror ? -1 : 1);
  state.panY = drag.panY + (event.clientY - drag.y) / stage.clientHeight;
  scheduleRender();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, () => { drag = null; });
stage.addEventListener('keydown', event => {
  if (event.target !== stage) return;
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (keys[event.key]) { event.preventDefault(); nudge(keys[event.key]); }
  if (event.code === 'Space') { event.preventDefault(); capturePhoto(); }
});
new ResizeObserver(scheduleRender).observe(stage);
window.addEventListener('pagehide', () => { stopCamera(); if (sceneObjectUrl) URL.revokeObjectURL(sceneObjectUrl); if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl); });
selectPreset('still-life');
syncControls();
updateGallery();
