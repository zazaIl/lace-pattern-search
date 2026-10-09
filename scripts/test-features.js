const Lace = require("../js/features.js");

function fill(width, height, fn) {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) gray[y * width + x] = fn(x, y);
  }
  return gray;
}

function lattice(gap, ink, paper) {
  return function (x, y) {
    const on = (x % gap) < 2 || (y % gap) < 2;
    return on ? ink : paper;
  };
}

function circles(x, y) {
  const gap = 28;
  const cx = (x % gap) - gap / 2;
  const cy = (y % gap) - gap / 2;
  const radius = Math.hypot(cx, cy);
  return radius > 6 && radius < 9 ? 24 : 236;
}

function waves(x, y) {
  const wave = Math.sin(x * 0.35 + Math.sin(y * 0.12) * 6);
  return wave > 0.35 ? 28 : 230;
}

function mapGray(src, fn) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 1) out[i] = fn(src[i], i);
  return out;
}

function shift(src, width, height, dx, dy) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const xx = (x + dx) % width;
      const yy = (y + dy) % height;
      out[y * width + x] = src[yy * width + xx];
    }
  }
  return out;
}

function crop(src, width, x0, y0, cw, ch) {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) out[y * cw + x] = src[(y0 + y) * width + (x0 + x)];
  }
  return out;
}

function pct(score) {
  return Math.round(score * 1000) / 10;
}

const width = 360;
const height = 168;
const base = fill(width, height, lattice(14, 32, 228));
const samples = {
  base: Lace.extractFeaturesFromGray(base, width, height),
  invert: Lace.extractFeaturesFromGray(mapGray(base, function (v) { return 255 - v; }), width, height),
  gamma: Lace.extractFeaturesFromGray(mapGray(base, function (v) { return Math.pow(v / 255, 0.55) * 255; }), width, height),
  fade: Lace.extractFeaturesFromGray(mapGray(base, function (v) { return v * 0.35 + 90; }), width, height),
  noise: Lace.extractFeaturesFromGray(mapGray(base, function (v, i) {
    const wobble = ((i * 17) % 11) - 5;
    return v + wobble;
  }), width, height),
  shift: Lace.extractFeaturesFromGray(shift(base, width, height, 7, 3), width, height),
  crop: Lace.extractFeaturesFromGray(crop(base, width, 37, 8, 150, 150), 150, 150),
  otherGap: Lace.extractFeaturesFromGray(fill(width, height, lattice(23, 32, 228)), width, height),
  circles: Lace.extractFeaturesFromGray(fill(width, height, circles), width, height),
  waves: Lace.extractFeaturesFromGray(fill(width, height, waves), width, height)
};

const names = Object.keys(samples);
const scores = {};
names.forEach(function (name) {
  scores[name] = pct(Lace.compareFeatures(samples[name], samples.base));
});

const again = Lace.extractFeaturesFromGray(base, width, height);
const deterministic = again.patches[0].p === samples.base.patches[0].p
  && again.patches[0].d === samples.base.patches[0].d
  && again.patches[0].t === samples.base.patches[0].t;

const decodedT = Lace.b64ToBytes(samples.base.patches[0].t);

console.log(JSON.stringify({
  weights: Lace.WEIGHTS,
  patches: samples.base.patches.length,
  templateBytes: decodedT.length,
  deterministic: deterministic,
  scores: scores,
  explainCrop: Lace.explain(samples.crop, samples.base),
  explainGap: Lace.explain(samples.otherGap, samples.base),
  explainCircles: Lace.explain(samples.circles, samples.base)
}, null, 2));

const failures = [];
function expect(cond, message) {
  if (!cond) failures.push(message);
}

expect(deterministic, "同一张图两次计算的哈希不一致");
expect(decodedT.length === 256, "纹理模板长度不对");
expect(scores.base >= 99, "同一张图相似度不是 100，实际 " + scores.base);
expect(scores.invert >= 90, "反相后相似度过低 " + scores.invert);
expect(scores.gamma >= 90, "灰度曲线变化后相似度过低 " + scores.gamma);
expect(scores.fade >= 90, "变淡后相似度过低 " + scores.fade);
expect(scores.noise >= 75, "轻微噪声后相似度过低 " + scores.noise);
expect(scores.shift >= 75, "平移后相似度过低 " + scores.shift);
expect(scores.crop >= 80, "局部花纹相似度过低 " + scores.crop);
expect(scores.noise > scores.otherGap + 8, "噪声样本没有拉开另一种网格 " + scores.noise + " vs " + scores.otherGap);
expect(scores.crop > scores.circles + 12, "局部花纹没有明显胜过圆点纹 " + scores.crop + " vs " + scores.circles);
expect(scores.crop > scores.waves + 12, "局部花纹没有明显胜过波浪纹 " + scores.crop + " vs " + scores.waves);
expect(scores.crop > scores.otherGap + 12, "局部花纹没有胜过另一种网格间距 " + scores.crop + " vs " + scores.otherGap);
expect(scores.base > scores.otherGap + 12, "不同间距的网格拉不开 " + scores.otherGap);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("ok");
