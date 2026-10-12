(function () {
  const MAX_EDGE = 960;
  const JPEG_QUALITY = 0.82;

  function isSupported(file) {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const extOk = /\.jpe?g$|\.png$/.test(name);
    if (type === "image/jpeg" || type === "image/jpg" || type === "image/png") return true;
    return extOk && (type === "" || type === "application/octet-stream");
  }

  function drawBitmap(bitmap, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    return canvas;
  }

  async function fileToCanvas(file, maxEdge) {
    const bitmap = await createImageBitmap(file);
    return drawBitmap(bitmap, maxEdge || MAX_EDGE);
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error("图片压缩失败"));
        else resolve(blob);
      }, "image/jpeg", quality == null ? JPEG_QUALITY : quality);
    });
  }

  async function blobToCanvas(blob) {
    const bitmap = await createImageBitmap(blob);
    return drawBitmap(bitmap, Math.max(bitmap.width, bitmap.height));
  }

  function featuresFromCanvas(canvas, options) {
    if (canvas.width < 16 || canvas.height < 16) throw new Error("图片太小，无法识别花纹");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return LaceFeatures.fromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
  }

  async function analyzeFile(file, options) {
    const canvas = await fileToCanvas(file, MAX_EDGE);
    const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY);
    const decoded = await blobToCanvas(blob);
    const features = await featuresFromCanvas(decoded, options);
    return {
      features: features,
      blob: blob,
      width: decoded.width,
      height: decoded.height
    };
  }

  async function analyzeUrl(url, options) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("读取样品图片失败");
    const blob = await response.blob();
    const canvas = await blobToCanvas(blob);
    return featuresFromCanvas(canvas, options || { trimHeader: true });
  }

  function cleanName(name) {
    const text = String(name || "").replace(/\s+/g, " ").trim();
    return (text || "未命名").slice(0, 48);
  }

  function nameFromFile(file) {
    const base = String(file.name || "未命名").replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
    return cleanName(base);
  }

  window.LaceImage = {
    isSupported: isSupported,
    analyzeFile: analyzeFile,
    analyzeUrl: analyzeUrl,
    cleanName: cleanName,
    nameFromFile: nameFromFile
  };
})();
