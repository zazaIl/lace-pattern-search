# Shape feature runtime

`js/vendor/shape-wasm.js` is a self-contained ~94 KiB WebAssembly bundle. It runs locally in browsers; no model or network API is required.

Upstream: https://github.com/vlfeat/vlfeat
Commit: 1b9075fc42fe54b42f0e937f8b9a230d8e2c7701
License: BSD, retained in `vlfeat/COPYING` and `js/vendor/VLFEAT-LICENSE.txt`.

`shape.c` selects scale-space keypoints, emits quantized RootSIFT descriptors, and wraps a seeded KD forest for approximate retrieval. Only the seven C translation units listed in `build.ps1` are compiled. The sole upstream source change enables the `generic.c` initialization constructor under `__EMSCRIPTEN__`.

Build with Emscripten (generated bundle tested with 6.0.12):

```powershell
./native/build.ps1 -Emcc /path/to/emscripten/emcc.py -Python python
```

Pass `-Config /path/to/.emscripten` if needed. The SDK is a developer build dependency and is not shipped with the website. The generated bundle is checked in, so ordinary static hosting requires no compilation.
