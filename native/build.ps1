param([string]$Emcc, [string]$Python = 'python', [string]$Config)
$ErrorActionPreference = 'Stop'
if ($Config) { $env:EM_CONFIG = $Config }
$sources = @('shape.c','vlfeat/vl/sift.c','vlfeat/vl/imopv.c','vlfeat/vl/mathop.c','vlfeat/vl/random.c','vlfeat/vl/generic.c','vlfeat/vl/host.c','vlfeat/vl/kdtree.c') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$compilerArgs = $sources + @('-I', (Join-Path $PSScriptRoot 'vlfeat'), '-O3', '-DNDEBUG', '-DVL_DISABLE_SSE2', '-DVL_DISABLE_AVX', '-DVL_DISABLE_THREADS', '-DVL_DISABLE_OPENMP', '-D__LITTLE_ENDIAN__=1', '-sMODULARIZE=1', '-sEXPORT_NAME=createLaceShapeModule', '-sSINGLE_FILE=1', '-sENVIRONMENT=web,node,worker', '-sALLOW_MEMORY_GROWTH=1', '-sFILESYSTEM=0', '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPF32","HEAPU32"]', '-sEXPORTED_FUNCTIONS=["_malloc","_free","_lace_extract","_lace_index","_lace_index_delete","_lace_query"]', '-o', (Join-Path $PSScriptRoot '../js/vendor/shape-wasm.js'))
& $Python $Emcc @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Shape module compilation failed' }
