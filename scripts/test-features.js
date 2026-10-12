const assert = require("assert/strict");
const Lace = require("../js/features.js");
function pattern(width, height, initialSeed = 127) {
  const pixels = new Uint8Array(width * height).fill(225);
  let seed = initialSeed;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  for (let i = 0; i < 90; i += 1) {
    const cx = 25 + random() * (width - 50), cy = 25 + random() * (height - 50);
    const rx = 8 + random() * 18, ry = 8 + random() * 18;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, cy + ry); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(width, cx + rx); x += 1) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d > 0.6 && d < 1) pixels[y * width + x] = 35;
      }
    }
  }
  return pixels;
}
async function main() {
  const width = 360, height = 360, pixels = pattern(width, height);
  const base = await Lace.extractFeaturesFromGray(pixels, width, height);
  const again = await Lace.extractFeaturesFromGray(pixels, width, height);
  const inverted = await Lace.extractFeaturesFromGray(pixels.map(v => 255 - v), width, height);
  const faded = await Lace.extractFeaturesFromGray(pixels.map(v => Math.round(v * 0.5 + 40)), width, height);
  const blank = await Lace.extractFeaturesFromGray(new Uint8Array(pixels.length).fill(127), width, height);
  const different = await Lace.extractFeaturesFromGray(pattern(width, height, 3331), width, height);
  assert.deepEqual(base, again, "feature extraction must be deterministic");
  assert.equal(Lace.b64ToBytes(base.patches[0].t).length, 1024);
  assert(Lace.usableSample(base));
  assert(!Lace.usableSample({ ...base, shape: undefined }), "pre-v5 features need a shape index rebuild");
  assert(!Lace.usableSample({ ...base, shape: { ...base.shape, width: Infinity } }), "invalid geometry must be rejected");
  assert(!Lace.usableSample({ ...base, shape: { ...base.shape, levels: [{ n: 20, p: "", d: "" }] } }), "truncated shape descriptors must be rejected");
  assert(!Lace.usableSample({ patches: base.patches }), "old indices must require rebuilding");
  assert(!Lace.usableSample({ ...base, local: { ...base.local, sets: [{ n: 100, p: "", d: "" }, base.local.sets[1]] } }));
  assert(Lace.compareFeatures(base, base) >= 0.98);
  assert(Lace.compareFeatures(inverted, base) >= 0.9, "contrast reversal must remain a match");
  assert(Lace.compareFeatures(faded, base) >= 0.8, "exposure changes must remain a match");
  assert.equal(Lace.compareFeatures(blank, blank), 0, "blank images must not be treated as evidence");
  assert.equal(Lace.compareFeatures(blank, base), 0);
  const unrelated = Lace.explain(base, different);
  assert(unrelated.score < 0.5, "different arrangements of similar shapes must not become strong matches");
  if (!unrelated.verified) assert(unrelated.score <= 0.2, "unverified structural references must remain capped at 20%");
  function recolor(ink, paper) {
    const rgba = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach(function (v, i) { rgba.set([...(v < 100 ? ink : paper), 255], i * 4); });
    return { width, height, data: rgba };
  }
  const blue = await Lace.fromImageData(recolor([30, 30, 200], [225, 225, 225]));
  const yellow = await Lace.fromImageData(recolor([225, 175, 20], [40, 70, 180]));
  assert.equal(blue.region.mode, "coverage", "equal R/G values must not collapse the chromatic axis");
  assert(Lace.compareFeatures(blue, yellow) >= 0.9, "hue and backdrop changes must preserve the pattern");
  const creamCard = new Uint8ClampedArray(width * (height + 80) * 4);
  for (let i = 0; i < width * 80; i += 1) creamCard.set([228, 218, 201, 255], i * 4);
  creamCard.set(recolor([225, 175, 20], [40, 70, 180]).data, width * 80 * 4);
  for (let y = 30; y < 34; y += 1) for (let x = 40; x < 140; x += 1) creamCard.set([30, 30, 30, 255], (y * width + x) * 4);
  const cream = await Lace.fromImageData({ width, height: height + 80, data: creamCard }, { trimHeader: true });
  assert(Math.abs(cream.region.top - 80 / (height + 80)) < 0.01, "warm cream card headers must be removed");
  assert(Lace.compareFeatures(cream, yellow) >= 0.9, "card paper color must not affect flower matching");
  function sharedCard(body) {
    const rgba = new Uint8ClampedArray(width * (height + 80) * 4), logo = pattern(width, 80, 77);
    for (let i = 0; i < width * 80; i += 1) rgba.set(i >= width * 20 && logo[i] < 100 ? [35, 35, 35, 255] : [228, 218, 201, 255], i * 4);
    for (let y = 76; y < 79; y += 1) for (let x = 0; x < width; x += 1) rgba.set([35, 35, 35, 255], (y * width + x) * 4);
    body.forEach((v, i) => rgba.set([v, v, v, 255], (width * 80 + i) * 4));
    return { width, height: height + 80, data: rgba };
  }
  const queryCard = await Lace.fromImageData(sharedCard(pixels));
  assert.equal(queryCard.region.top, 0, "query images must retain the complete image, even with a card-like header");
  assert.equal(queryCard.local.height, height + 80, "query geometry must keep the full image coordinate frame");
  assert(queryCard.region.excludedLabelTop > 0, "recognized card labels must not consume the pattern keypoint budget");
  const cardA = await Lace.fromImageData(sharedCard(pixels), { trimHeader: true });
  const cardB = await Lace.fromImageData(sharedCard(pattern(width, height, 3331)), { trimHeader: true });
  assert(Lace.compareFeatures(queryCard, cardA) >= 0.65, "a complete query must match a library image with its label removed");
  assert(Lace.compareFeatures(queryCard, cardB) < 0.5, "query labels must not match unrelated indexed fabric");
  const coloredLabel = sharedCard(pixels);
  for (let y = 22; y < 64; y += 1) for (let x = 35; x < 220; x += 1) {
    const offset = (y * width + x) * 4;
    if (coloredLabel.data[offset] < 100) coloredLabel.data.set([180, 25, 65, 255], offset);
  }
  const coloredQuery = await Lace.fromImageData(coloredLabel);
  assert.equal(coloredQuery.region.top, 0, "colored labels must not cause query cropping");
  assert.equal(coloredQuery.region.mode, "luminance", "colored logos must not change neutral fabric to a chromatic representation");
  assert(Lace.compareFeatures(coloredQuery, cardA) >= 0.65);
  assert(cardA.region.top >= 0.18 && cardB.region.top >= 0.18, "shared logos and separator rows must be excluded even on pale fabric");
  assert(Lace.compareFeatures(cardA, cardB) < 0.5, "identical card labels must not make different flower arrangements match");
  const bytes = Uint8Array.from({ length: 1024 }, (_, i) => (i * 31 + Math.floor(i / 32) * 17) ** 2 % 251);
  const shifted = new Uint8Array(1024);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) shifted[y * 32 + x] = bytes[((y + 3) % 32) * 32 + (x + 7) % 32];
  const parts = Lace.comparePatches({ t: Buffer.from(bytes).toString("base64") }, { t: Buffer.from(shifted).toString("base64") });
  assert.equal(parts.p, 1, "aligned pHash must use the correct shift direction");
  assert.equal(parts.d, 1, "aligned dHash must use the correct shift direction");
  assert(parts.total >= 0.999);
  const sync = Lace.rank(base, [blank, base]);
  const asyncRank = await Lace.rankAsync(base, [blank, base]);
  assert.deepEqual(sync.map(r => r.score), asyncRank.map(r => r.score));
  console.log("Feature, polarity, exposure, blank-image, alignment and index validation tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
