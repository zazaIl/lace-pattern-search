const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
async function main() {
  let supplied = { version: 2, samples: [{ id: "s001", file: "samples/s001.jpg", patches: [{}] }] };
  let accept;
  const context = {
    window: { LACE_CONFIG: { owner: "test", repo: "test", branch: "main", indexPath: "data/index.json" } },
    LaceFeatures: { VERSION: 5 },
    LacePaths: { isSampleFile: p => /^samples\/[a-z0-9]+\.jpg$/.test(p) },
    fetch: async (url, options) => { accept = options.headers.Accept; return { ok: true, text: async () => JSON.stringify(supplied) }; }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../js/github.js"), "utf8"), context);
  const old = await context.window.LaceGitHub.readIndex("test-only");
  assert.equal(old.version, 2, "old index version must not be silently promoted");
  assert.equal(old.samples.length, 1, "older feature records must remain available to rebuild");
  assert.equal(accept, "application/vnd.github.raw+json", "large indices require the raw contents media type");
  supplied = { version: 5, samples: [{ id: "s001", file: "samples/s001.jpg", local: {} }, { id: "unsafe", file: "../private.txt" }] };
  const upgraded = await context.window.LaceGitHub.readIndex("test-only");
  assert.equal(upgraded.version, 5);
  assert.equal(upgraded.samples.length, 1, "unsafe paths must still be excluded");
  console.log("Index upgrade, record preservation and large-file API tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
