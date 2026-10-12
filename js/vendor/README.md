# OpenCV runtime

`opencv.js` is the self-contained official OpenCV 4.13.0 WebAssembly build, downloaded from https://docs.opencv.org/4.13.0/opencv.js on 2026-10-12. It includes its own WebAssembly data; there are no runtime CDN requests.

The upstream Apache 2.0 license is included as `OPENCV-LICENSE.txt`, sourced from https://github.com/opencv/opencv/blob/4.13.0/LICENSE. This runtime supplies ORB, nearest-neighbor matching and RANSAC homography estimation. Application-level color normalization, evidence scoring and index handling are in the adjacent application code.

SHA-256: `63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0`.

# RootSIFT runtime

`shape-wasm.js` is built from the vendored VLFeat C sources and `native/shape.c` using Emscripten 6.0.12. See `native/README.md` for the exact source revision, patch and rebuild command. The BSD license is included in `VLFEAT-LICENSE.txt`. This ~94 KiB bundle contains the WASM binary and has no CDN dependency.
