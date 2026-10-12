/* Local pattern verification. Color is projected to a per-image chromatic axis,
   never compared between images. Both contrast polarities are indexed. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LaceLocalFeatures = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const EDGE = 720;
  const POINTS = 650;
  let runtime;
  const cache = new WeakMap();
  const validation = new WeakMap();
  const comparisons = new WeakMap();

  function ready() {
    if (!runtime) runtime = new Promise(function (resolve, reject) {
      const cv = root.cv || (typeof require === "function" ? require("./vendor/opencv.js") : null);
      if (!cv) { reject(new Error("花纹识别组件未加载，请刷新页面后重试")); return; }
      // This OpenCV build is a self-resolving thenable: resolving it directly
      // would recurse forever. Resolve a wrapper instead.
      if (cv.Mat) { resolve({ cv: cv }); return; }
      const previous = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = function () {
        if (previous) previous();
        resolve({ cv: cv });
      };
      cv.onAbort = function () { reject(new Error("花纹识别组件初始化失败")); };
    });
    return runtime;
  }

  function encode(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function decode(text) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
    const binary = atob(text);
    return Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
  }
  function stretch(values, statisticsStart) {
    const sorted = values.slice(statisticsStart || 0).sort();
    const lo = sorted[Math.floor(sorted.length * 0.03)];
    const hi = sorted[Math.floor((sorted.length - 1) * 0.97)];
    const out = new Uint8Array(values.length);
    if (hi - lo < 1e-6) return out;
    for (let i = 0; i < out.length; i += 1) out[i] = Math.round(Math.max(0, Math.min(1, (values[i] - lo) / (hi - lo))) * 255);
    return out;
  }

  function headerEnd(data, width, height, requireSeparator) {
    const probe = Math.max(1, Math.round(height * 0.04));
    const channels = [[], [], []];
    for (let y = 0; y < probe; y += 1) for (let x = 0; x < width; x += 3) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) channels[c].push(data[p + c]);
    }
    const paper = channels.map(function (values) { values.sort(function (a, b) { return a - b; }); return values[Math.floor(values.length / 2)]; });
    function whiteFraction(y) {
      let white = 0, count = 0;
      for (let x = 0; x < width; x += 3) {
        const p = (y * width + x) * 4;
        const lo = Math.min(data[p], data[p + 1], data[p + 2]);
        const hi = Math.max(data[p], data[p + 1], data[p + 2]);
        // Learn this card's paper tone. A broad "light color" test confused
        // pale blue lace with cream paper and retained the shared card logo.
        if (lo > 160 && hi - lo < 40 && Math.max(Math.abs(data[p] - paper[0]), Math.abs(data[p + 1] - paper[1]), Math.abs(data[p + 2] - paper[2])) < 30) white += 1;
        count += 1;
      }
      return white / count;
    }
    let white = 0;
    for (let y = 0; y < probe; y += 1) white += whiteFraction(y);
    if (white / probe < 0.8) return 0;
    // Text occupies sparse rows; fabric occupies a sustained wide band.
    const band = Math.max(4, Math.round(height * 0.012));
    let consecutive = 0, fabricTop = 0;
    for (let y = probe; y < height * 0.35; y += 1) {
      consecutive = whiteFraction(y) < 0.55 ? consecutive + 1 : 0;
      if (consecutive >= band) { fabricTop = Math.max(0, y - consecutive + 1); break; }
    }
    // A thin, wide dark separator is a reliable card cue even for very pale
    // fabric. Exclude the telephone rows below it as well as the main logo.
    let run = 0, separator = 0;
    const darkLimit = Math.min.apply(Math, paper) - 60;
    for (let y = probe; y < height * 0.28; y += 1) {
      let dark = 0, count = 0;
      for (let x = 0; x < width; x += 3) {
        const p = (y * width + x) * 4;
        if (Math.max(data[p], data[p + 1], data[p + 2]) < darkLimit) dark += 1;
        count += 1;
      }
      if (dark / count > 0.7) run += 1;
      else {
        if (run && run <= height * 0.012 && y > height * 0.06) separator = y;
        run = 0;
      }
    }
    if (requireSeparator && !separator) return 0;
    return Math.min(Math.round(height * 0.35), Math.max(fabricTop, separator ? Math.round(separator + height * 0.055) : 0));
  }

  async function prepare(imageData, options) {
    const cv = (await ready()).cv;
    const source = cv.matFromImageData(imageData);
    const resized = new cv.Mat();
    try {
      const scale = Math.min(1, EDGE / Math.max(source.cols, source.rows));
      cv.resize(source, resized, new cv.Size(Math.round(source.cols * scale), Math.round(source.rows * scale)), 0, 0, cv.INTER_AREA);
      const width = resized.cols;
      // Only library indexing removes card labels. Query photographs retain
      // their entire field of view, including motifs near the top edge.
      const libraryImage = options && options.trimHeader === true;
      // Query exclusion requires an actual card separator, not just a light
      // background above fabric. The query's dimensions never change.
      const detectedHeader = headerEnd(resized.data, width, resized.rows, !libraryImage);
      const top = libraryImage ? detectedHeader : 0;
      const height = resized.rows - top;
      const data = resized.data.subarray(top * width * 4);
      // Retain every query pixel and its coordinates, but estimate the yarn/
      // background axis from fabric rather than a colored logo on a card.
      const statisticsStart = (detectedHeader - top) * width;
      const mean = [0, 0, 0], cov = new Float64Array(9);
      let count = 0;
      for (let i = statisticsStart * 4; i < data.length; i += 28) {
        const sum = data[i] + data[i + 1] + data[i + 2] + 1;
        const rgb = [data[i] / sum, data[i + 1] / sum, data[i + 2] / sum];
        for (let a = 0; a < 3; a += 1) {
          mean[a] += rgb[a];
          for (let b = 0; b < 3; b += 1) cov[a * 3 + b] += rgb[a] * rgb[b];
        }
        count += 1;
      }
      for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) cov[a * 3 + b] = cov[a * 3 + b] / count - mean[a] * mean[b] / (count * count);
      let axis = [1, -1, 0];
      for (let iter = 0; iter < 24; iter += 1) {
        const next = [0, 0, 0];
        for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) next[a] += cov[a * 3 + b] * axis[b];
        const norm = Math.hypot.apply(Math, next);
        if (norm < 1e-12) {
          if (iter === 0) {
            const diagonal = [cov[0], cov[4], cov[8]];
            const strongest = diagonal.indexOf(Math.max.apply(Math, diagonal));
            axis = [0, 0, 0]; axis[strongest] = 1;
            continue;
          }
          break;
        }
        axis = next.map(function (n) { return n / norm; });
      }
      let variance = 0;
      for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) variance += axis[a] * cov[a * 3 + b] * axis[b];
      const values = new Float32Array(width * height), luminance = new Float32Array(width * height);
      // Small chromatic variation in neutral fabric is often JPEG noise.
      // A hard color/gray switch made the same image change representation
      // after re-encoding. Blend continuously, and use gray for neutral cloth.
      const colorWeight = Math.max(0, Math.min(1, (variance - 0.001) / 0.002));
      for (let p = 0, i = 0; p < values.length; p += 1, i += 4) {
        const sum = data[i] + data[i + 1] + data[i + 2] + 1;
        values[p] = (data[i] * axis[0] + data[i + 1] * axis[1] + data[i + 2] * axis[2]) / sum;
        luminance[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }
      let gray;
      if (colorWeight === 0) gray = stretch(luminance, statisticsStart);
      else if (colorWeight === 1) gray = stretch(values, statisticsStart);
      else {
        const coverage = stretch(values, statisticsStart), light = stretch(luminance, statisticsStart);
        let sumC = 0, sumL = 0, cross = 0, n = 0;
        for (let i = statisticsStart; i < coverage.length; i += 7) { sumC += coverage[i]; sumL += light[i]; cross += coverage[i] * light[i]; n += 1; }
        const flip = cross / n - sumC * sumL / (n * n) < 0;
        gray = Uint8Array.from(light, function (v, i) {
          return Math.round((1 - colorWeight) * v + colorWeight * (flip ? 255 - coverage[i] : coverage[i]));
        });
      }
      return { gray: gray, width: width, height: height, featureTop: detectedHeader - top, region: { top: top / resized.rows, excludedLabelTop: (detectedHeader - top) / resized.rows, mode: colorWeight === 0 ? "luminance" : colorWeight === 1 ? "coverage" : "blended", colorVariance: variance, colorWeight: colorWeight } };
    } finally { resized.delete(); source.delete(); }
  }

  async function extract(gray, width, height, featureTop) {
    const cv = (await ready()).cv;
    const offset = featureTop || 0;
    // Labels do not consume the keypoint budget or influence CLAHE. Restore
    // the original y coordinate so geometry and search strips use the full
    // input image, including when a user supplies a complete sample card.
    const source = cv.matFromArray(height - offset, width, cv.CV_8UC1, gray.subarray(offset * width));
    const equalized = new cv.Mat(), smooth = new cv.Mat(), inverted = new cv.Mat(), mask = new cv.Mat();
    const contrast = new cv.CLAHE(2, new cv.Size(8, 8));
    const orb = new cv.ORB(POINTS, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 10);
    const sets = [];
    try {
      // Local histogram normalization removes the strong contrast differences
      // caused by shadows and yarn/background colors without comparing hues.
      contrast.apply(source, equalized);
      cv.GaussianBlur(equalized, smooth, new cv.Size(0, 0), 1.5, 1.5, cv.BORDER_DEFAULT);
      cv.bitwise_not(smooth, inverted);
      [smooth, inverted].forEach(function (image) {
        const keypoints = new cv.KeyPointVector(), descriptors = new cv.Mat();
        try {
          orb.detectAndCompute(image, mask, keypoints, descriptors, false);
          const points = new Uint16Array(keypoints.size() * 2);
          for (let i = 0; i < keypoints.size(); i += 1) {
            const point = keypoints.get(i);
            points[i * 2] = Math.round(point.pt.x * 32);
            points[i * 2 + 1] = Math.round((point.pt.y + offset) * 32);
          }
          // Explicit little endian packing, including on non-LE hosts.
          const packed = new Uint8Array(points.length * 2);
          const view = new DataView(packed.buffer);
          for (let i = 0; i < points.length; i += 1) view.setUint16(i * 2, points[i], true);
          sets.push({ n: keypoints.size(), p: encode(packed), d: encode(descriptors.data) });
        } finally { descriptors.delete(); keypoints.delete(); }
      });
      return { width: width, height: height, sets: sets };
    } finally { orb.delete(); contrast.delete(); mask.delete(); inverted.delete(); smooth.delete(); equalized.delete(); source.delete(); }
  }

  function unpack(set) {
    let result = cache.get(set);
    if (!result) {
      const bytes = decode(set.p), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const points = new Float32Array(set.n * 2);
      for (let i = 0; i < points.length; i += 1) points[i] = view.getUint16(i * 2, true) / 32;
      result = { points: points, descriptors: decode(set.d) };
      cache.set(set, result);
    }
    return result;
  }

  function usable(local) {
    if (!local || !Number.isFinite(local.width) || !Number.isFinite(local.height) || local.width < 16 || local.height < 16 || !Array.isArray(local.sets) || local.sets.length !== 2) return false;
    try {
      return local.sets.every(function (set) {
        if (!set || !Number.isInteger(set.n) || set.n < 0 || set.n > POINTS || typeof set.p !== "string" || typeof set.d !== "string") return false;
        const previous = validation.get(set);
        if (previous && previous.n === set.n && previous.p === set.p && previous.d === set.d) return previous.valid;
        const valid = decode(set.p).length === set.n * 4 && decode(set.d).length === set.n * 32;
        validation.set(set, { n: set.n, p: set.p, d: set.d, valid: valid });
        return valid;
      });
    } catch (err) { return false; }
  }

  function saneHomography(h, width, height) {
    if (!h || h.length !== 9 || !Array.from(h).every(Number.isFinite)) return false;
    const den = [h[8], h[6] * width + h[8], h[7] * height + h[8], h[6] * width + h[7] * height + h[8]];
    if (den.some(function (d) { return Math.abs(d) < 1e-5 || d * den[0] <= 0; })) return false;
    const a = h[0] / h[8], b = h[1] / h[8], c = h[3] / h[8], d = h[4] / h[8];
    const determinant = a * d - b * c;
    const energy = a * a + b * b + c * c + d * d;
    return determinant > 0.025 && determinant < 36 && energy / determinant < 12;
  }

  // Overlapping halves and thirds keep motifs crossing a cut available.
  // Coordinates stay in the original image so geometry remains meaningful.
  function regions(width, height) {
    const out = [{ x: 0, y: 0, w: width, h: height, name: "full" }];
    [0.5, 1 / 3].forEach(function (fraction) {
      [0, (1 - fraction) / 2, 1 - fraction].forEach(function (start) {
        out.push({ x: start * width, y: 0, w: fraction * width, h: height, name: fraction === 0.5 ? "half" : "third" });
      });
    });
    return out;
  }
  function inside(points, i, region) {
    const x = points[i * 2], y = points[i * 2 + 1];
    return x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h;
  }

  function verifyMatches(matches, left, right, query, sample, qr, sr, cv) {
    const empty = { score: 0, inliers: 0, matches: matches.length, coverage: 0, verified: false };
    const regional = qr.name !== "full" || sr.name !== "full";
    if (matches.length < (regional ? 12 : 8)) return empty;
    const allocated = [];
    try {
      const qa = [], sa = [];
      matches.forEach(function (m) {
        qa.push(left.points[m.q * 2], left.points[m.q * 2 + 1]);
        sa.push(right.points[m.s * 2], right.points[m.s * 2 + 1]);
      });
      const src = cv.matFromArray(matches.length, 1, cv.CV_32FC2, qa);
      const dst = cv.matFromArray(matches.length, 1, cv.CV_32FC2, sa);
      const mask = new cv.Mat();
      allocated.push(src, dst, mask);
      cv.setRNGSeed(13579);
      const homography = cv.findHomography(src, dst, cv.RANSAC, 6, mask, 2000, 0.995);
      allocated.push(homography);
      if (homography.empty() || !saneHomography(homography.data64F, query.width, query.height)) return empty;
      let n = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (let i = 0; i < matches.length; i += 1) if (mask.data[i]) {
        n += 1;
        minX = Math.min(minX, qa[i * 2]); maxX = Math.max(maxX, qa[i * 2]);
        minY = Math.min(minY, qa[i * 2 + 1]); maxY = Math.max(maxY, qa[i * 2 + 1]);
        sx0 = Math.min(sx0, sa[i * 2]); sx1 = Math.max(sx1, sa[i * 2]);
        sy0 = Math.min(sy0, sa[i * 2 + 1]); sy1 = Math.max(sy1, sa[i * 2 + 1]);
      }
      const coverage = n ? ((maxX - minX) * (maxY - minY)) / (qr.w * qr.h) : 0;
      const sampleCoverage = n ? ((sx1 - sx0) * (sy1 - sy0)) / (sr.w * sr.h) : 0;
      const ratio = n / matches.length;
      // A regional search tests more hypotheses: demand more independent
      // correspondences, spread on BOTH images, and a stronger inlier ratio.
      const verified = n >= (regional ? 12 : 8) && coverage >= 0.04 && sampleCoverage >= 0.02 && ratio >= (regional ? 0.25 : 0.2);
      const score = verified ? 0.75 * (1 - Math.exp(-Math.max(0, n - 4) / 22)) + 0.15 * ratio + 0.1 * Math.min(1, coverage / 0.35) : 0;
      return { score: Math.min(1, score), inliers: n, matches: matches.length, coverage: coverage, verified: verified, queryRegion: qr.name, sampleRegion: sr.name };
    } finally { allocated.reverse().forEach(function (m) { m.delete(); }); }
  }

  function verify(a, b, query, sample, cv) {
    const empty = { score: 0, inliers: 0, matches: 0, coverage: 0, verified: false };
    if (a.n < 8 || b.n < 8) return empty;
    const left = unpack(a), right = unpack(b);
    const da = cv.matFromArray(a.n, 32, cv.CV_8UC1, left.descriptors);
    const db = cv.matFromArray(b.n, 32, cv.CV_8UC1, right.descriptors);
    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const pairs = new cv.DMatchVectorVector();
    try {
      // Keep several near neighbours. On repeating lace, the two best global
      // neighbours can be copies of the same motif; a global ratio test alone
      // wrongly discards them. Apply the ratio test inside each candidate strip.
      matcher.knnMatch(da, db, pairs, Math.min(8, b.n));
      const neighbours = [];
      for (let i = 0; i < pairs.size(); i += 1) {
        const pair = pairs.get(i);
        try {
          const row = [];
          for (let j = 0; j < pair.size(); j += 1) {
            const m = pair.get(j); row.push({ q: m.queryIdx, s: m.trainIdx, distance: m.distance });
          }
          neighbours.push(row);
        } finally { pair.delete(); }
      }
      // Give unverified candidates an appearance-only ordering, rather than
      // an arbitrary tie at zero. This never contributes to a verified score.
      // The closest half limits interference from background/occlusion.
      const distances = neighbours.filter(function (row) { return row.length; }).map(function (row) { return row[0].distance; }).sort(function (a, b) { return a - b; });
      const count = Math.ceil(distances.length / 2);
      const appearance = count ? 0.2 * distances.slice(0, count).reduce(function (sum, d) { return sum + Math.max(0, 1 - d / 80); }, 0) / count : 0;
      let best = empty;
      const qrs = regions(query.width, query.height), srs = regions(sample.width, sample.height);
      for (let si = 0; si < srs.length; si += 1) {
        const sr = srs[si], candidates = [];
        neighbours.forEach(function (row) {
          const local = row.filter(function (m) { return inside(right.points, m.s, sr); });
          if (!local.length || row.length < 2) return;
          // If the second strip neighbour is outside the top eight, its
          // distance is at least the last returned global distance.
          const nextDistance = local.length >= 2 ? local[1].distance : row[row.length - 1].distance;
          if (local[0].distance <= 64 && local[0].distance < 0.8 * nextDistance) candidates.push(local[0]);
        });
        candidates.sort(function (a, b) { return a.distance - b.distance; });
        for (let qi = 0; qi < qrs.length; qi += 1) {
          const qr = qrs[qi], seen = new Set();
          const matches = candidates.filter(function (m) {
            if (!inside(left.points, m.q, qr) || seen.has(m.s)) return false;
            seen.add(m.s); return true;
          });
          const result = verifyMatches(matches, left, right, query, sample, qr, sr, cv);
          if (result.score > best.score) best = result;
          if (best.score >= 0.88) return Object.assign({}, best, { appearance: appearance });
        }
      }
      return Object.assign({}, best, { appearance: appearance });
    } finally {
      pairs.delete(); matcher.delete(); db.delete(); da.delete();
    }
  }

  function compare(query, sample) {
    const cv = root.cv || (typeof require === "function" ? require("./vendor/opencv.js") : null);
    if (!cv || !cv.Mat || !usable(query) || !usable(sample)) return { score: 0, inliers: 0, matches: 0, coverage: 0, verified: false };
    let memo = comparisons.get(query);
    if (!memo) { memo = new WeakMap(); comparisons.set(query, memo); }
    if (memo.has(sample)) return memo.get(sample);
    const results = sample.sets.map(function (set) { return verify(query.sets[0], set, query, sample, cv); });
    const best = results.sort(function (a, b) { return b.score - a.score || (b.appearance || 0) - (a.appearance || 0); })[0];
    memo.set(sample, best);
    return best;
  }
  return { ready: ready, prepare: prepare, extract: extract, compare: compare, usable: usable };
});
