const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Draws one slide as a PNG. A slide is plain data:
//   { bg: ['#1ED760', '#0B3D20'], elements: [
//     { type: 'box', x, y, w, h, color, alpha? },
//     { type: 'text', text, x, y, size, font?: 'black'|'bold'|'regular', color?, alpha?, align?: 'left'|'center'|'right', maxWidth? },
//     { type: 'image', url, x, y, w, h, round? } ] }
// Text y is the top of the line. Text that would run past maxWidth is cut with "…".

const WIDTH = 900;
const HEIGHT = 1125;

const FONT_FAMILIES = { black: 'WrappedBlack', bold: 'WrappedBold', regular: 'WrappedRegular' };
let fontsReady = false;

/** Registers the bundled fonts once (or the owner's own, from config.fonts). */
function setupFonts(custom = {}) {
  if (fontsReady) return;
  const dir = path.join(__dirname, '..', 'fonts');
  const files = {
    black: custom.black || path.join(dir, 'Montserrat_900Black.ttf'),
    bold: custom.bold || path.join(dir, 'Montserrat_700Bold.ttf'),
    regular: custom.regular || path.join(dir, 'Montserrat_500Medium.ttf'),
  };
  for (const [key, file] of Object.entries(files)) GlobalFonts.registerFromPath(file, FONT_FAMILIES[key]);
  fontsReady = true;
}

const fontCss = (size, font = 'bold') => `${size}px ${FONT_FAMILIES[font] || FONT_FAMILIES.bold}`;

const measureCtx = createCanvas(10, 10).getContext('2d');
function textWidth(text, size, font = 'bold') {
  measureCtx.font = fontCss(size, font);
  return measureCtx.measureText(String(text)).width;
}

/** Keeps what the fonts can draw (Latin, Cyrillic, common punctuation and currency); anything else (emoji, CJK…) is dropped. */
function drawable(textIn) {
  const cleaned = String(textIn ?? '')
    .normalize('NFC')
    .replace(/[^\u0020-\u024F\u0400-\u04FF\u2010-\u2027\u2030-\u205E\u20A0-\u20BF\u2122\u2212\u25B2\u25BC\u00A0-\u00FF]/g, '')
    .replace(/\(\s*\)|\[\s*\]|''|""/g, '') // brackets left empty once other scripts are dropped
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '?';
}

/** Cuts `text` with an ellipsis so it fits within `maxWidth` pixels. */
function fitText(textIn, size, font = 'bold', maxWidth = WIDTH - 120) {
  const t = drawable(textIn);
  if (textWidth(t, size, font) <= maxWidth) return t;
  const chars = [...t];
  while (chars.length > 1 && textWidth(`${chars.join('').trimEnd()}…`, size, font) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return loadImage(Buffer.from(await res.arrayBuffer()));
}

/** Renders `slide` and returns the PNG as a Buffer. */
async function renderSlide(slide) {
  setupFonts();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const [c0, c1] = slide.bg || ['#1ED760', '#121212'];
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, c0);
  gradient.addColorStop(1, c1);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Pictures load in parallel; one that won't load is simply left out.
  const images = await Promise.all((slide.elements || []).map((el) => (el.type === 'image' && el.url ? fetchImage(el.url).catch(() => null) : null)));

  (slide.elements || []).forEach((el, i) => {
    ctx.save();
    if (el.type === 'box') {
      ctx.globalAlpha = el.alpha ?? 1;
      ctx.fillStyle = el.color || '#FFFFFF';
      ctx.fillRect(el.x, el.y, el.w, el.h);
    } else if (el.type === 'text') {
      const font = el.font || 'bold';
      ctx.font = fontCss(el.size, font);
      ctx.fillStyle = el.color || '#FFFFFF';
      ctx.globalAlpha = el.alpha ?? 1;
      ctx.textBaseline = 'top';
      ctx.textAlign = el.align || 'left';
      const x = el.align === 'center' ? WIDTH / 2 : el.x;
      ctx.fillText(fitText(el.text, el.size, font, el.maxWidth), x, el.y);
    } else if (el.type === 'image' && images[i]) {
      const img = images[i];
      // Cover-crop to the box, like a profile picture.
      const scale = Math.max(el.w / img.width, el.h / img.height);
      const sw = el.w / scale;
      const sh = el.h / scale;
      if (el.round) {
        ctx.beginPath();
        ctx.arc(el.x + el.w / 2, el.y + el.h / 2, Math.min(el.w, el.h) / 2, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, el.x, el.y, el.w, el.h);
    }
    ctx.restore();
  });
  return canvas.toBuffer('image/png');
}

module.exports = { renderSlide, setupFonts, fitText, drawable, textWidth, WIDTH, HEIGHT };
