'use strict';

// ShotMatch mobile prototype. The image pipeline, measurement and guidance logic
// mirror the web demo (../../js/app.js); this file adds the phone UI layer:
// bottom sheets, pinch zoom, ghost overlay, camera flip, Android back button,
// haptics and native save/share through Capacitor plugins when available.

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
const ZOOM_MIN = 1, ZOOM_MAX = 1.65;
const state = { mode: 'demo', sceneId: 'still-life', referencePreset: 'still-life', source: null, reference: null, referenceStats: null, panX: .08, panY: -.018, zoom: 1.12, mirror: false, grid: true, ghost: false, ghostOpacity: 35, facing: 'environment', settings: neutral(), captures: [], currentCapture: null };

// Capacitor bridge (present only inside the Android app).
const Cap = window.Capacitor;
const isNative = !!Cap?.isNativePlatform?.();
const Plugins = Cap?.Plugins || {};

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
let wasAligned = false;
let resumeCamera = false;
let openSheetId = null;
const imageCache = new Map();
const stage = $('stage');
const canvas = $('preview');
const context = canvas.getContext('2d', { alpha: false });
const video = $('camera-video');
const measurement = document.createElement('canvas');
measurement.width = 80;
measurement.height = 60;
const measurementContext = measurement.getContext('2d', { willReadFrequently: true });

icons();
$('shutter').disabled = true;

function haptic(style = 'LIGHT') {
  try {
    if (Plugins.Haptics) Plugins.Haptics.impact({ style });
    else navigator.vibrate?.(style === 'HEAVY' ? 18 : 8);
  } catch { /* haptics are optional */ }
}

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
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
  ctx.fillStyle = '#1a2622';
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

function setReferenceImage(src, name) {
  for (const id of ['reference-image', 'reference-pip-image', 'reference-tool-image', 'ghost']) $(id).src = src;
  $('reference-name').textContent = name;
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

function setCue(title, detail) {
  if ($('cue-title').textContent !== title) $('cue-title').textContent = title;
  if ($('cue-detail').textContent !== detail) $('cue-detail').textContent = detail;
}

function setScore(score) {
  const ring = $('alignment-ring');
  ring.classList.toggle('manual', score === null);
  ring.style.setProperty('--score', score ?? 0);
  $('alignment-value').textContent = score === null ? 'FREE' : `${score}%`;
}

function updateGuidance() {
  const matchable = canMatch();
  $('align-button').disabled = !matchable;
  $('subject-box').hidden = !matchable;
  $('guide-mode').textContent = matchable ? 'PRESET FRAMING' : 'MANUAL REFERENCE';
  if (!matchable) {
    setScore(null);
    setAligned(false);
    setCue('Your eye, your frame.', state.ghost ? 'Line your shot up with the ghosted reference.' : 'Tap the ghost icon to overlay your reference while you frame.');
    Object.assign($('target-box').style, { left: '24%', top: '16%', width: '52%', height: '68%' });
    return;
  }
  const error = Math.hypot(state.panX, state.panY) * 2.1 + (state.zoom - 1) * .75;
  const score = Math.round(clamp(100 - error * 100, 0, 100));
  setScore(score);
  const width = stage.clientWidth, height = stage.clientHeight;
  const box = presets[state.sceneId].box;
  placeBox($('target-box'), box, state.source, { panX: 0, panY: 0, zoom: 1, mirror: state.mirror }, width, height);
  placeBox($('subject-box'), box, state.source, state, width, height);
  const horizontal = state.mirror ? -state.panX : state.panX;
  let aligned = false;
  if (Math.abs(horizontal) > .022) {
    const side = horizontal > 0 ? 'left' : 'right';
    setCue(`A little to the ${side}.`, 'Drag the subject toward the dashed reference outline.');
  } else if (state.zoom > 1.035) {
    setCue('Give it some room.', 'Pinch out: the subject is larger than in the reference.');
  } else if (Math.abs(state.panY) > .018) {
    setCue('Level the framing.', 'Bring the subject toward the reference height.');
  } else {
    aligned = true;
    setCue('That is the frame.', 'Guides line up. Make the look your own, then shoot.');
  }
  setAligned(aligned);
}

function setAligned(aligned) {
  $('alignment-ring').classList.toggle('aligned', aligned);
  stage.classList.toggle('aligned', aligned);
  $('shutter').classList.toggle('ready', aligned);
  if (aligned && !wasAligned) haptic('MEDIUM');
  wasAligned = aligned;
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
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(stage.clientWidth * ratio), height = Math.round(stage.clientHeight * ratio);
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  drawPhoto(context, state.source, width, height, state, state.settings);
  $('composition-grid').hidden = !state.grid;
  $('ghost').hidden = !state.ghost;
  $('ghost').style.opacity = state.ghostOpacity / 100;
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
  $('look-dot').hidden = settingsKeys.every(key => state.settings[key] === 0);
  $('zoom').value = state.zoom;
  $('zoom-chip').textContent = `${state.zoom.toFixed(2)}x`;
  rangePaint($('zoom'));
  setToggle('mirror-toggle', state.mirror);
  setToggle('grid-toggle', state.grid);
  setToggle('ghost-toggle', state.ghost);
  $('ghost-switch').checked = state.ghost;
  $('ghost-opacity').value = state.ghostOpacity;
  $('ghost-opacity-value').textContent = `${state.ghostOpacity}%`;
  rangePaint($('ghost-opacity'));
}

function setToggle(id, on) {
  $(id).classList.toggle('active', on);
  $(id).setAttribute('aria-pressed', on);
}

function updateModes() {
  const shown = { demo: state.mode === 'demo', camera: state.mode === 'camera', photo: state.mode === 'photo' };
  for (const mode of Object.keys(shown)) {
    $(`${mode}-mode`).classList.toggle('selected', shown[mode]);
    $(`${mode}-mode`).setAttribute('aria-pressed', shown[mode]);
  }
  $('source-text').textContent = state.mode === 'camera' ? 'LIVE' : state.mode === 'photo' ? 'YOUR PHOTO' : 'DEMO SCENE';
  $('live-dot').classList.toggle('recording', state.mode === 'camera');
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
      setReferenceImage(reference.src, presets[id].name);
    }
    $('look-status').textContent = 'Original colors';
    syncControls(); updateModes(); scheduleRender();
  } catch (error) { notify(error.message); }
}

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
async function openFile(file, role) {
  if (!file) return;
  // Android pickers sometimes hand over names without extensions, so accept a valid MIME type or extension.
  const typeOk = allowedTypes.includes(file.type);
  const nameOk = /\.(jpe?g|png|webp|avif)$/i.test(file.name);
  if (!typeOk && !(nameOk && !file.type)) { notify('Choose a JPG, PNG, WebP or AVIF image.'); return; }
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
      setReferenceImage(url, file.name || 'Your reference');
      notify('Reference imported. Stays on this phone.');
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
      closeSheet();
      notify('Photo opened. Drag and pinch to frame it.');
    }
    scheduleRender();
  } catch (error) { URL.revokeObjectURL(url); notify(error.message); }
}

async function startCamera(facing = state.facing, force = false) {
  if (state.mode === 'camera' && !force) return;
  if (!navigator.mediaDevices?.getUserMedia) { showCameraError('Camera access is unavailable here. You can still use demo scenes or open a photo.'); return; }
  const token = ++sourceToken;
  $('camera-mode').disabled = true;
  $('flip-camera').disabled = true;
  $('camera-error').hidden = true;
  let pendingStream;
  try {
    pendingStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
    if (token !== sourceToken) { pendingStream.getTracks().forEach(track => track.stop()); return; }
    stopCamera();
    stream = pendingStream;
    video.srcObject = stream;
    await video.play();
    if (token !== sourceToken) { pendingStream.getTracks().forEach(track => track.stop()); return; }
    alignmentToken++;
    const wasCamera = state.mode === 'camera';
    state.facing = facing;
    state.source = video;
    state.mode = 'camera'; state.sceneId = null;
    state.panX = 0; state.panY = 0; state.zoom = 1;
    state.mirror = facing === 'user';
    if (!wasCamera) { state.settings = neutral(); $('look-status').textContent = 'Original colors'; }
    syncControls(); updateModes();
    let lastFrame = 0;
    const tick = time => {
      if (state.mode !== 'camera') return;
      if (!document.hidden && time - lastFrame > 33) { lastFrame = time; scheduleRender(); }
      cameraAnimation = requestAnimationFrame(tick);
    };
    cameraAnimation = requestAnimationFrame(tick);
    if (!wasCamera) notify('Camera live. Subject tracking remains a concept feature.');
  } catch (error) {
    pendingStream?.getTracks().forEach(track => track.stop());
    if (token !== sourceToken) return;
    showCameraError(error.name === 'NotAllowedError' ? 'Camera permission was not granted. Allow it in Android Settings > Apps > ShotMatch, or use a demo scene.' : error.name === 'NotFoundError' || error.name === 'OverconstrainedError' ? 'No matching camera was found. Use a demo scene or open a photo instead.' : 'The camera could not start. Check that another app is not using it.');
  } finally { $('camera-mode').disabled = false; $('flip-camera').disabled = false; }
}

function showCameraError(message) {
  $('camera-error').textContent = message;
  $('camera-error').hidden = false;
}

function matchFraming() {
  if (!canMatch()) return;
  haptic();
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
  haptic();
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
  $('look-status').textContent = 'Suggested from reference colors';
  notify('A starting look, based on reference colors.');
}

function capturePhoto() {
  if (!state.source) return;
  haptic('HEAVY');
  const shot = document.createElement('canvas');
  shot.width = 1600; shot.height = 1200;
  const ctx = shot.getContext('2d');
  drawPhoto(ctx, state.source, 1600, 1200, state, neutral());
  const original = shot.toDataURL('image/jpeg', .94);
  drawPhoto(ctx, state.source, 1600, 1200, state, state.settings);
  const edited = shot.toDataURL('image/jpeg', .94);
  const capture = { id: ++captureSequence, original, edited, date: new Date(), settings: { ...state.settings } };
  state.captures.unshift(capture);
  if (state.captures.length > 8) { state.captures.pop(); notify('The gallery keeps your latest 8 shots. Save photos to keep them.'); }
  $('capture-flash').classList.remove('fire');
  void $('capture-flash').offsetWidth;
  $('capture-flash').classList.add('fire');
  updateGallery();
  setTimeout(() => openReview(capture), 220);
}

function openReview(capture) {
  state.currentCapture = capture;
  $('review-before').src = capture.original;
  $('review-after').src = capture.edited;
  $('comparison-range').value = 50;
  updateComparison();
  closeSheet();
  if ($('gallery-dialog').open) $('gallery-dialog').close();
  if (!$('review-dialog').open) $('review-dialog').showModal();
}

function updateComparison() {
  const value = $('comparison-range').value;
  $('review-after-wrap').style.clipPath = `inset(0 0 0 ${value}%)`;
  $('comparison-divider').style.left = `${value}%`;
  rangePaint($('comparison-range'));
}

function captureFile(original) {
  const capture = state.currentCapture;
  return { name: `shotmatch-${Date.now()}-${String(capture.id).padStart(2, '0')}-${original ? 'original' : 'look'}.jpg`, dataUrl: original ? capture.original : capture.edited };
}

// Native: write straight into Pictures/ShotMatch so it shows up in the phone gallery.
async function saveCapture(original) {
  if (!state.currentCapture) return;
  const file = captureFile(original);
  const fs = Plugins.Filesystem;
  if (!isNative || !fs) {
    const link = document.createElement('a');
    link.href = file.dataUrl; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    return;
  }
  const data = file.dataUrl.split(',')[1];
  try {
    await fs.writeFile({ path: `Pictures/ShotMatch/${file.name}`, data, directory: 'EXTERNAL_STORAGE', recursive: true });
    haptic('MEDIUM');
    notify('Saved to Pictures / ShotMatch.');
  } catch {
    try {
      await fs.writeFile({ path: `ShotMatch/${file.name}`, data, directory: 'DOCUMENTS', recursive: true });
      notify('Saved to Documents / ShotMatch.');
    } catch { notify('Could not save here. Use Share to send it to Photos or Files.'); }
  }
}

async function shareCapture() {
  if (!state.currentCapture) return;
  const file = captureFile(false);
  try {
    if (isNative && Plugins.Filesystem && Plugins.Share) {
      const written = await Plugins.Filesystem.writeFile({ path: file.name, data: file.dataUrl.split(',')[1], directory: 'CACHE' });
      await Plugins.Share.share({ title: 'My ShotMatch shot', text: 'Shot with ShotMatch', files: [written.uri], dialogTitle: 'Share your shot' });
      return;
    }
    const blob = await (await fetch(file.dataUrl)).blob();
    const shareFile = new File([blob], file.name, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [shareFile] })) await navigator.share({ files: [shareFile], title: 'My ShotMatch shot' });
    else notify('Sharing is not available here. Use Save instead.');
  } catch (error) {
    if (!/cancel/i.test(error?.message || '') && error?.name !== 'AbortError') notify('Sharing was not completed.');
  }
}

function updateGallery() {
  const count = state.captures.length;
  $('gallery-count').textContent = count;
  $('gallery-count').hidden = count === 0;
  $('gallery-total').textContent = `${count} ${count === 1 ? 'photo' : 'photos'} this session`;
  $('gallery-empty').hidden = count > 0;
  $('clear-gallery').disabled = count === 0;
  $('last-capture').disabled = count === 0;
  $('last-capture').replaceChildren();
  $('gallery-grid').replaceChildren();
  if (count) {
    const thumbnail = document.createElement('img'); thumbnail.src = state.captures[0].edited; thumbnail.alt = 'Latest capture';
    $('last-capture').append(thumbnail);
  } else {
    const icon = document.createElement('i'); icon.dataset.lucide = 'image'; $('last-capture').append(icon);
  }
  state.captures.forEach((capture, index) => {
    const button = document.createElement('button'); button.className = 'gallery-item';
    button.style.animationDelay = `${index * 40}ms`;
    const image = document.createElement('img'); image.src = capture.edited; image.alt = `Capture ${capture.id}`;
    const label = document.createElement('span'); label.textContent = `Shot ${String(capture.id).padStart(2, '0')} / ${capture.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    button.append(image, label); button.addEventListener('click', () => openReview(capture));
    $('gallery-grid').append(button);
  });
  icons();
}

// ---------- Bottom sheets ----------
function openSheet(id) {
  if (openSheetId === id) { closeSheet(); return; }
  closeSheet(true);
  haptic();
  openSheetId = id;
  const sheet = $(id);
  sheet.classList.remove('closing');
  sheet.hidden = false;
  $('sheet-backdrop').classList.toggle('light', sheet.classList.contains('sheet-peek'));
  $('sheet-backdrop').hidden = false;
}

function closeSheet(immediate = false) {
  if (!openSheetId) return;
  const sheet = $(openSheetId);
  openSheetId = null;
  $('sheet-backdrop').hidden = true;
  if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) { sheet.hidden = true; return; }
  sheet.classList.add('closing');
  sheet.addEventListener('animationend', () => { if (sheet.classList.contains('closing')) { sheet.hidden = true; sheet.classList.remove('closing'); } }, { once: true });
}

// Swipe a sheet down by its handle/header to dismiss.
document.querySelectorAll('.sheet').forEach(sheet => {
  let startY = null;
  const head = [sheet.querySelector('.sheet-handle'), sheet.querySelector('.sheet-head')];
  head.forEach(el => el.addEventListener('pointerdown', event => { if (!event.target.closest('button')) { startY = event.clientY; sheet.setPointerCapture(event.pointerId); } }));
  sheet.addEventListener('pointermove', event => { if (startY !== null) sheet.style.transform = `translateY(${Math.max(0, event.clientY - startY)}px)`; });
  const end = event => {
    if (startY === null) return;
    const moved = event.clientY - startY;
    startY = null;
    sheet.style.transform = '';
    if (moved > 80) closeSheet();
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
});

// ---------- Viewfinder gestures: drag to reframe, pinch to zoom, double-tap to reset ----------
const pointers = new Map();
let gesture = null;
let lastTap = 0;
function beginGesture() {
  const points = [...pointers.values()];
  if (points.length === 1) gesture = { type: 'drag', x: points[0].x, y: points[0].y, panX: state.panX, panY: state.panY };
  else if (points.length >= 2) gesture = { type: 'pinch', distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom: state.zoom, cx: (points[0].x + points[1].x) / 2, cy: (points[0].y + points[1].y) / 2, panX: state.panX, panY: state.panY };
}
stage.addEventListener('pointerdown', event => {
  if (event.target.closest('button')) return;
  alignmentToken++;
  stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  beginGesture();
  if (pointers.size === 1) {
    const now = performance.now();
    if (now - lastTap < 280) resetFraming();
    lastTap = now;
  }
});
stage.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId) || !gesture) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const points = [...pointers.values()];
  const direction = state.mirror ? -1 : 1;
  if (gesture.type === 'drag' && points.length === 1) {
    state.panX = gesture.panX + (points[0].x - gesture.x) / stage.clientWidth * direction;
    state.panY = gesture.panY + (points[0].y - gesture.y) / stage.clientHeight;
  } else if (gesture.type === 'pinch' && points.length >= 2) {
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    state.zoom = clamp(gesture.zoom * distance / Math.max(gesture.distance, 1), ZOOM_MIN, ZOOM_MAX);
    const cx = (points[0].x + points[1].x) / 2, cy = (points[0].y + points[1].y) / 2;
    state.panX = gesture.panX + (cx - gesture.cx) / stage.clientWidth * direction;
    state.panY = gesture.panY + (cy - gesture.cy) / stage.clientHeight;
    syncControls();
  }
  scheduleRender();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, event => {
  if (!pointers.delete(event.pointerId)) return;
  if (pointers.size) beginGesture(); else gesture = null;
});

function resetFraming() {
  alignmentToken++;
  state.panX = 0; state.panY = 0; state.zoom = 1;
  haptic();
  syncControls(); scheduleRender();
}

// ---------- Wiring ----------
document.querySelectorAll('[data-scene]').forEach(button => button.addEventListener('click', () => { haptic(); selectPreset(button.dataset.scene); setTimeout(closeSheet, 250); }));
document.querySelectorAll('[data-sheet]').forEach(button => button.addEventListener('click', () => openSheet(button.dataset.sheet)));
document.querySelectorAll('[data-close-sheet]').forEach(button => button.addEventListener('click', () => closeSheet()));
$('sheet-backdrop').addEventListener('click', () => closeSheet());
$('reference-pip').addEventListener('click', () => openSheet('reference-sheet'));
$('reference-import').addEventListener('click', () => $('reference-file').click());
$('scene-import').addEventListener('click', () => $('scene-file').click());
for (const role of ['reference', 'scene']) $(role + '-file').addEventListener('change', event => { openFile(event.target.files[0], role); event.target.value = ''; });
$('demo-mode').addEventListener('click', () => { haptic(); selectPreset(state.sceneId || 'still-life'); });
$('camera-mode').addEventListener('click', () => { haptic(); startCamera(); });
$('photo-mode').addEventListener('click', () => { haptic(); $('scene-file').click(); });
$('flip-camera').addEventListener('click', () => { haptic(); startCamera(state.mode === 'camera' ? (state.facing === 'user' ? 'environment' : 'user') : state.facing, true); });
$('align-button').addEventListener('click', matchFraming);
$('suggest-look').addEventListener('click', suggestLook);
$('suggest-quick').addEventListener('click', suggestLook);
$('look-reset').addEventListener('click', () => { haptic(); state.settings = neutral(); syncControls(); scheduleRender(); $('look-status').textContent = 'Original colors'; });
$('framing-reset').addEventListener('click', resetFraming);
$('zoom').addEventListener('input', event => { alignmentToken++; state.zoom = Number(event.target.value); syncControls(); scheduleRender(); });
for (const key of settingsKeys) $(key).addEventListener('input', event => { state.settings[key] = Number(event.target.value); syncControls(); scheduleRender(); $('look-status').textContent = 'Your custom look'; });
const setGhost = on => { state.ghost = on; haptic(); syncControls(); scheduleRender(); };
$('ghost-toggle').addEventListener('click', () => setGhost(!state.ghost));
$('ghost-switch').addEventListener('change', event => setGhost(event.target.checked));
$('ghost-opacity').addEventListener('input', event => { state.ghostOpacity = Number(event.target.value); if (!state.ghost) state.ghost = true; syncControls(); scheduleRender(); });
$('grid-toggle').addEventListener('click', () => { state.grid = !state.grid; haptic(); syncControls(); scheduleRender(); });
$('mirror-toggle').addEventListener('click', () => { state.mirror = !state.mirror; haptic(); syncControls(); scheduleRender(); });
$('shutter').addEventListener('click', capturePhoto);
$('review-close').addEventListener('click', () => $('review-dialog').close());
$('download-original').addEventListener('click', () => saveCapture(true));
$('download-edited').addEventListener('click', () => saveCapture(false));
$('share-edited').addEventListener('click', shareCapture);
$('comparison-range').addEventListener('input', updateComparison);
$('last-capture').addEventListener('click', () => state.captures[0] && openReview(state.captures[0]));
$('gallery-open').addEventListener('click', () => { haptic(); closeSheet(true); updateGallery(); $('gallery-dialog').showModal(); });
$('gallery-close').addEventListener('click', () => $('gallery-dialog').close());
$('clear-gallery').addEventListener('click', () => { state.captures = []; state.currentCapture = null; $('review-before').removeAttribute('src'); $('review-after').removeAttribute('src'); updateGallery(); notify('Session gallery cleared. Saved files are unchanged.'); });
stage.addEventListener('keydown', event => {
  if (event.target !== stage) return;
  const step = .018, keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (keys[event.key]) { event.preventDefault(); alignmentToken++; state.panX += keys[event.key][0] * (state.mirror ? -1 : 1); state.panY += keys[event.key][1]; scheduleRender(); }
  if (event.code === 'Space') { event.preventDefault(); capturePhoto(); }
});
new ResizeObserver(scheduleRender).observe(stage);

// Android hardware back: close the top-most layer first, then leave the app.
function handleBack() {
  if ($('review-dialog').open) { $('review-dialog').close(); return true; }
  if ($('gallery-dialog').open) { $('gallery-dialog').close(); return true; }
  if (openSheetId) { closeSheet(); return true; }
  return false;
}
if (Plugins.App) {
  Plugins.App.addListener('backButton', () => { if (!handleBack()) Plugins.App.minimizeApp(); });
}

// Release the camera in the background and bring it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resumeCamera = state.mode === 'camera';
    if (resumeCamera) stopCamera();
  } else if (resumeCamera) {
    resumeCamera = false;
    startCamera(state.facing, true);
  }
});
window.addEventListener('pagehide', () => { stopCamera(); if (sceneObjectUrl) URL.revokeObjectURL(sceneObjectUrl); if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl); });

selectPreset('still-life');
syncControls();
updateGallery();
