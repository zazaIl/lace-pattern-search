/* 花边纹理特征
   1. 转成灰度梯度，去掉颜色和明暗方向
   2. 找出花纹的重复间距，把一个到两个重复单元对齐后比较
   3. pHash、dHash 描述单元形状，空间模板区分不同图案
   4. 因此局部截图、变色、轻微错位仍能对上同一块花边
*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LaceFeatures = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VERSION = 1;
  const WEIGHTS = { p: 0.12, d: 0.08, t: 0.8 };
  const POP = new Uint8Array(16);
  for (let i = 1; i < 16; i += 1) POP[i] = (i & 1) + POP[i >> 1];
  const byteCache = new WeakMap();
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function bytesToB64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const triple = (a << 16) | (b << 8) | c;
      out += B64[(triple >> 18) & 63];
      out += B64[(triple >> 12) & 63];
      out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : "=";
      out += i + 2 < bytes.length ? B64[triple & 63] : "=";
    }
    return out;
  }

  function b64ToBytes(text) {
    const clean = String(text || "").replace(/[^A-Za-z0-9+/=]/g, "");
    if (!clean) return new Uint8Array(0);
    const len = clean.length;
    let pad = 0;
    if (clean.endsWith("==")) pad = 2;
    else if (clean.endsWith("=")) pad = 1;
    const out = new Uint8Array(((len * 3) / 4) - pad);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const c2 = clean[i + 2] === "=" ? 0 : B64.indexOf(clean[i + 2]);
      const c3 = clean[i + 3] === "=" ? 0 : B64.indexOf(clean[i + 3]);
      const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | (c2 << 6) | c3;
      if (p < out.length) out[p++] = (n >> 16) & 255;
      if (clean[i + 2] !== "=" && p < out.length) out[p++] = (n >> 8) & 255;
      if (clean[i + 3] !== "=" && p < out.length) out[p++] = n & 255;
    }
    return out;
  }

  function bytesOf(patch) {
    let cached = byteCache.get(patch);
    if (!cached) {
      cached = { t: b64ToBytes(patch.t) };
      byteCache.set(patch, cached);
    }
    return cached;
  }

  function clampGray(gray) {
    const out = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) {
      const value = gray[i];
      out[i] = Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
    }
    return out;
  }

  function boxBlur(src, width, height) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += src[yy * width + xx];
            count += 1;
          }
        }
        dst[y * width + x] = sum / count;
      }
    }
    return dst;
  }

  function gradientMagnitude(src, width, height) {
    const dst = new Float32Array(src.length);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const row = y * width;
        const gx =
          -src[row - width + (x - 1)] + src[row - width + (x + 1)] +
          -2 * src[row + (x - 1)] + 2 * src[row + (x + 1)] +
          -src[row + width + (x - 1)] + src[row + width + (x + 1)];
        const gy =
          -src[row - width + (x - 1)] - 2 * src[row - width + x] - src[row - width + (x + 1)] +
          src[row + width + (x - 1)] + 2 * src[row + width + x] + src[row + width + (x + 1)];
        dst[row + x] = Math.hypot(gx, gy);
      }
    }
    return dst;
  }

  function stretch(src) {
    const sorted = Array.from(src).sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.02)] || 0;
    const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] || 1;
    const span = Math.max(1e-6, high - low);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 1) {
      out[i] = Math.max(0, Math.min(255, ((src[i] - low) / span) * 255));
    }
    return out;
  }

  function dct1(input) {
    const n = input.length;
    const out = new Float64Array(n);
    const factor = Math.PI / n;
    for (let k = 0; k < n; k += 1) {
      let sum = 0;
      for (let i = 0; i < n; i += 1) sum += input[i] * Math.cos(factor * (i + 0.5) * k);
      out[k] = sum;
    }
    return out;
  }

  function dct2(gray, n) {
    const rows = new Array(n);
    for (let y = 0; y < n; y += 1) rows[y] = dct1(gray.subarray(y * n, y * n + n));
    const cols = new Array(n);
    for (let x = 0; x < n; x += 1) {
      const col = new Float64Array(n);
      for (let y = 0; y < n; y += 1) col[y] = rows[y][x];
      cols[x] = dct1(col);
    }
    const out = new Array(n);
    for (let y = 0; y < n; y += 1) {
      const row = new Float64Array(n);
      for (let x = 0; x < n; x += 1) row[x] = cols[x][y];
      out[y] = row;
    }
    return out;
  }

  function median(values) {
    const arr = values.slice().sort((a, b) => a - b);
    const mid = arr.length >> 1;
    if (arr.length % 2) return arr[mid];
    return (arr[mid - 1] + arr[mid]) / 2;
  }

  function bitsToHex(bits) {
    let hex = "";
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }

  function phashFromDct(dct) {
    const coeffs = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) coeffs.push(dct[y][x]);
    }
    const mid = median(coeffs);
    let bits = "";
    for (let i = 0; i < coeffs.length; i += 1) bits += coeffs[i] > mid ? "1" : "0";
    return bitsToHex(bits);
  }

  function dhashFrom(small) {
    let bits = "";
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) bits += small[y * 9 + x] < small[y * 9 + x + 1] ? "1" : "0";
    }
    return bitsToHex(bits);
  }

  function project(src, width, height, axis) {
    if (axis === "x") {
      const proj = new Float64Array(width);
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let y = 0; y < height; y += 1) sum += src[y * width + x];
        proj[x] = sum / height;
      }
      return proj;
    }
    const proj = new Float64Array(height);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      const row = y * width;
      for (let x = 0; x < width; x += 1) sum += src[row + x];
      proj[y] = sum / width;
    }
    return proj;
  }

  function autocorr1d(proj) {
    const n = proj.length;
    let mean = 0;
    for (let i = 0; i < n; i += 1) mean += proj[i];
    mean /= n || 1;
    const out = new Float64Array(n);
    for (let lag = 0; lag < n; lag += 1) {
      let sum = 0;
      const count = n - lag;
      for (let i = 0; i < count; i += 1) sum += (proj[i] - mean) * (proj[i + lag] - mean);
      out[lag] = sum / count;
    }
    const norm = Math.abs(out[0]) > 1e-8 ? out[0] : 1;
    for (let i = 0; i < n; i += 1) out[i] /= norm;
    return out;
  }

  function findPeriod(ac) {
    const maxLag = Math.min(ac.length - 2, Math.floor(ac.length * 0.5));
    if (maxLag < 8) return 0;
    let seenTrough = false;
    for (let lag = 5; lag <= maxLag; lag += 1) {
      if (ac[lag] < 0.15) seenTrough = true;
      const peak = ac[lag] >= ac[lag - 1] && ac[lag] > ac[lag + 1];
      if (seenTrough && peak && ac[lag] >= 0.3) return lag;
    }
    let bestLag = 0;
    let best = 0.35;
    for (let lag = 8; lag <= maxLag; lag += 1) {
      if (ac[lag] > best && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
        best = ac[lag];
        bestLag = lag;
      }
    }
    return bestLag;
  }

  function argmax(arr, limit) {
    let best = -Infinity;
    let idx = 0;
    const n = Math.min(arr.length, Math.max(1, limit));
    for (let i = 0; i < n; i += 1) {
      if (arr[i] > best) {
        best = arr[i];
        idx = i;
      }
    }
    return idx;
  }

  function takeEven(items, count) {
    if (items.length <= count) return items.slice();
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
    }
    return out;
  }

  function fallbackWindows(width, height) {
    const minSide = Math.min(width, height);
    const all = [];
    const seen = new Set();
    [1, 0.62].forEach(function (scale) {
      const side = Math.max(16, Math.min(width, height, Math.round(minSide * scale)));
      const step = Math.max(8, Math.round(side * 0.55));
      const group = [];
      for (let y = 0; y + side <= height; y += step) {
        for (let x = 0; x + side <= width; x += step) {
          const key = x + "," + y + "," + side;
          if (seen.has(key)) continue;
          seen.add(key);
          group.push({ x: x, y: y, w: side, h: side });
        }
      }
      takeEven(group, 3).forEach(function (item) { all.push(item); });
    });
    if (!all.length) {
      const side = Math.min(width, height);
      all.push({
        x: Math.floor((width - side) / 2),
        y: Math.floor((height - side) / 2),
        w: side,
        h: side
      });
    }
    return all.slice(0, 6);
  }

  function periodWindows(width, height, px, py, projX, projY) {
    const rects = [];
    const seen = new Set();
    const anchorX = px ? argmax(projX, px) : 0;
    const anchorY = py ? argmax(projY, py) : 0;
    function push(x, y, tw, th) {
      const xx = Math.max(0, Math.min(Math.max(0, width - tw), x));
      const yy = Math.max(0, Math.min(Math.max(0, height - th), y));
      const key = xx + "," + yy + "," + tw + "," + th;
      if (seen.has(key) || tw < 12 || th < 12) return;
      seen.add(key);
      rects.push({ x: xx, y: yy, w: tw, h: th });
    }
    [1, 2].forEach(function (mult) {
      const baseX = px || py || Math.round(Math.min(width, height) / 3);
      const baseY = py || px || baseX;
      const tw = Math.max(12, Math.min(width, baseX * mult));
      const th = Math.max(12, Math.min(height, baseY * mult));
      push(anchorX, anchorY, tw, th);
    });
    return rects.length ? rects : fallbackWindows(width, height);
  }

  function fitSquare(src, width, height, rect, dest) {
    const out = new Float32Array(dest * dest);
    const dw = Math.max(1, Math.round(rect.w * (dest / Math.max(rect.w, rect.h))));
    const dh = Math.max(1, Math.round(rect.h * (dest / Math.max(rect.w, rect.h))));
    const ox = Math.floor((dest - dw) / 2);
    const oy = Math.floor((dest - dh) / 2);
    for (let y = 0; y < dh; y += 1) {
      const sy0 = rect.y + (y * rect.h) / dh;
      const sy1 = rect.y + ((y + 1) * rect.h) / dh;
      const yStart = Math.max(0, Math.min(height - 1, Math.floor(sy0)));
      const yEnd = Math.max(yStart, Math.min(height - 1, Math.ceil(sy1) - 1));
      for (let x = 0; x < dw; x += 1) {
        const sx0 = rect.x + (x * rect.w) / dw;
        const sx1 = rect.x + ((x + 1) * rect.w) / dw;
        const xStart = Math.max(0, Math.min(width - 1, Math.floor(sx0)));
        const xEnd = Math.max(xStart, Math.min(width - 1, Math.ceil(sx1) - 1));
        let sum = 0;
        let count = 0;
        for (let yy = yStart; yy <= yEnd; yy += 1) {
          const row = yy * width;
          for (let xx = xStart; xx <= xEnd; xx += 1) {
            sum += src[row + xx];
            count += 1;
          }
        }
        out[(oy + y) * dest + (ox + x)] = count ? sum / count : 0;
      }
    }
    return out;
  }

  function downsample(square, size, destW, destH) {
    const out = new Float32Array(destW * destH);
    for (let y = 0; y < destH; y += 1) {
      const y0 = Math.floor((y * size) / destH);
      const y1 = Math.max(y0, Math.ceil(((y + 1) * size) / destH) - 1);
      for (let x = 0; x < destW; x += 1) {
        const x0 = Math.floor((x * size) / destW);
        const x1 = Math.max(x0, Math.ceil(((x + 1) * size) / destW) - 1);
        let sum = 0;
        let count = 0;
        for (let yy = y0; yy <= y1 && yy < size; yy += 1) {
          for (let xx = x0; xx <= x1 && xx < size; xx += 1) {
            sum += square[yy * size + xx];
            count += 1;
          }
        }
        out[y * destW + x] = count ? sum / count : 0;
      }
    }
    return out;
  }

  function patchFromRect(structure, width, height, rect) {
    const fitted = fitSquare(structure, width, height, rect, 32);
    const dct = dct2(fitted, 32);
    const small = downsample(fitted, 32, 9, 8);
    const template = fitSquare(structure, width, height, rect, 16);
    const bytes = new Uint8Array(template.length);
    for (let i = 0; i < template.length; i += 1) {
      bytes[i] = Math.max(0, Math.min(255, Math.round(template[i])));
    }
    return {
      p: phashFromDct(dct),
      d: dhashFrom(small),
      t: bytesToB64(bytes)
    };
  }

  function extractFeaturesFromGray(gray, width, height) {
    if (width < 16 || height < 16) throw new Error("图片太小，无法识别花纹");
    const clean = clampGray(gray);
    const blurred = boxBlur(clean, width, height);
    const structure = stretch(gradientMagnitude(blurred, width, height));
    const projX = project(structure, width, height, "x");
    const projY = project(structure, width, height, "y");
    const px = findPeriod(autocorr1d(projX));
    const py = findPeriod(autocorr1d(projY));
    const windows = px || py
      ? periodWindows(width, height, px, py, projX, projY)
      : fallbackWindows(width, height);
    const patches = windows.map(function (rect) {
      return patchFromRect(structure, width, height, rect);
    });
    return { patches: patches };
  }

  function fromImageData(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < src.length; i += 4, p += 1) {
      gray[p] = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    }
    return extractFeaturesFromGray(gray, width, height);
  }

  function hammingHex(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    let dist = 0;
    for (let i = 0; i < a.length; i += 1) dist += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
    return dist;
  }

  const specCache = new WeakMap();
  const rowRe = new Float64Array(16);
  const rowIm = new Float64Array(16);
  const crossRe = new Float64Array(256);
  const crossIm = new Float64Array(256);

  function fftRadix2(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
      const wlenRe = Math.cos(ang);
      const wlenIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wRe = 1;
        let wIm = 0;
        const half = len >> 1;
        for (let j = 0; j < half; j += 1) {
          const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
          const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
          const uRe = re[i + j];
          const uIm = im[i + j];
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + half] = uRe - vRe;
          im[i + j + half] = uIm - vIm;
          const nextRe = wRe * wlenRe - wIm * wlenIm;
          wIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nextRe;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i += 1) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  function fft2(re, im, inverse) {
    for (let y = 0; y < 16; y += 1) {
      const row = y * 16;
      for (let x = 0; x < 16; x += 1) {
        rowRe[x] = re[row + x];
        rowIm[x] = im[row + x];
      }
      fftRadix2(rowRe, rowIm, inverse);
      for (let x = 0; x < 16; x += 1) {
        re[row + x] = rowRe[x];
        im[row + x] = rowIm[x];
      }
    }
    for (let x = 0; x < 16; x += 1) {
      for (let y = 0; y < 16; y += 1) {
        rowRe[y] = re[y * 16 + x];
        rowIm[y] = im[y * 16 + x];
      }
      fftRadix2(rowRe, rowIm, inverse);
      for (let y = 0; y < 16; y += 1) {
        re[y * 16 + x] = rowRe[y];
        im[y * 16 + x] = rowIm[y];
      }
    }
  }

  function spectrumOf(patch) {
    let spec = specCache.get(patch);
    if (spec) return spec;
    const bytes = bytesOf(patch).t;
    const re = new Float64Array(256);
    const im = new Float64Array(256);
    let mean = 0;
    for (let i = 0; i < 256; i += 1) mean += bytes[i];
    mean /= 256;
    let energy = 0;
    for (let i = 0; i < 256; i += 1) {
      const centered = bytes[i] - mean;
      re[i] = centered;
      energy += centered * centered;
    }
    fft2(re, im, false);
    spec = { re: re, im: im, norm: Math.sqrt(energy), bytes: bytes };
    specCache.set(patch, spec);
    return spec;
  }

  function alignPair(a, b) {
    const left = spectrumOf(a);
    const right = spectrumOf(b);
    for (let i = 0; i < 256; i += 1) {
      crossRe[i] = left.re[i] * right.re[i] + left.im[i] * right.im[i];
      crossIm[i] = left.im[i] * right.re[i] - left.re[i] * right.im[i];
    }
    fft2(crossRe, crossIm, true);
    let best = -Infinity;
    let index = 0;
    for (let i = 0; i < 256; i += 1) {
      if (crossRe[i] > best) {
        best = crossRe[i];
        index = i;
      }
    }
    const den = left.norm * right.norm;
    const corr = den < 1e-8 ? 0 : best / den;
    return {
      corr: Math.max(-1, Math.min(1, corr)),
      dx: index % 16,
      dy: Math.floor(index / 16),
      bytesA: left.bytes,
      bytesB: right.bytes
    };
  }

  function sampleAligned(bytes, x, y, dx, dy) {
    return bytes[((y + dy) & 15) * 16 + ((x + dx) & 15)];
  }

  function alignedHashes(bytesA, bytesB, dx, dy) {
    const left = new Float64Array(256);
    const right = new Float64Array(256);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        left[y * 16 + x] = bytesA[y * 16 + x];
        right[y * 16 + x] = sampleAligned(bytesB, x, y, dx, dy);
      }
    }
    const p = 1 - hammingHex(phashFromDct(dct2(left, 16)), phashFromDct(dct2(right, 16))) / 64;
    const d = 1 - hammingHex(dhashFrom(downsample(left, 16, 9, 8)), dhashFrom(downsample(right, 16, 9, 8))) / 64;
    return { p: p, d: d };
  }

  function pairParts(a, b) {
    const aligned = alignPair(a, b);
    const texture = Math.max(0, aligned.corr);
    const hashes = texture > 0.72 ? alignedHashes(aligned.bytesA, aligned.bytesB, aligned.dx, aligned.dy) : { p: 0.5, d: 0.5 };
    const total = WEIGHTS.p * hashes.p + WEIGHTS.d * hashes.d + WEIGHTS.t * texture;
    return {
      p: hashes.p,
      d: hashes.d,
      t: texture,
      total: Math.max(0, Math.min(1, total))
    };
  }

  function compareFeatures(query, sample) {
    const left = query && query.patches ? query.patches : [];
    const right = sample && sample.patches ? sample.patches : [];
    if (!left.length || !right.length) return 0;
    const scores = left.map(function (patch) {
      let best = 0;
      for (let i = 0; i < right.length; i += 1) {
        const total = pairParts(patch, right[i]).total;
        if (total > best) best = total;
      }
      return best;
    });
    scores.sort(function (a, b) { return b - a; });
    const best = scores[0];
    const k = Math.min(2, scores.length);
    let sum = 0;
    for (let i = 0; i < k; i += 1) sum += scores[i];
    return 0.82 * best + 0.18 * (sum / k);
  }

  function explain(query, sample) {
    let best = null;
    const left = query.patches || [];
    const right = sample.patches || [];
    for (let i = 0; i < left.length; i += 1) {
      for (let j = 0; j < right.length; j += 1) {
        const parts = pairParts(left[i], right[j]);
        if (!best || parts.total > best.total) best = parts;
      }
    }
    return best;
  }

  function rank(queryFeatures, samples) {
    return samples.map(function (sample) {
      return { sample: sample, score: compareFeatures(queryFeatures, sample) };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function usableSample(sample) {
    if (!sample || !Array.isArray(sample.patches) || !sample.patches.length) return false;
    return sample.patches.every(function (patch) {
      return patch && patch.p && patch.d && patch.t;
    });
  }

  return {
    VERSION: VERSION,
    WEIGHTS: WEIGHTS,
    fromImageData: fromImageData,
    extractFeaturesFromGray: extractFeaturesFromGray,
    compareFeatures: compareFeatures,
    explain: explain,
    rank: rank,
    usableSample: usableSample,
    b64ToBytes: b64ToBytes
  };
});
