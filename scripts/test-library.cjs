const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("assert/strict");
const { chromium } = require(process.env.LACE_NODE_MODULES ? path.join(process.env.LACE_NODE_MODULES, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
const candidate = process.argv.includes("--candidate");
const indexOnly = process.argv.includes("--index-only");
const rebuild = process.argv.includes("--rebuild") || indexOnly;
const shardArg = process.argv.find(arg => arg.startsWith("--shard="));
const [shard, shards] = shardArg ? shardArg.slice(8).split("/").map(Number) : [0, 1];
assert(Number.isInteger(shard) && Number.isInteger(shards) && shard >= 0 && shard < shards && shards <= 8, "invalid shard");
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      const types = { ".js": "application/javascript", ".html": "text/html", ".css": "text/css", ".jpg": "image/jpeg", ".json": "application/json" };
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.LACE_BROWSER ? { executablePath: process.env.LACE_BROWSER } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", msg => { if (msg.text().startsWith("test:")) console.log(msg.text()); });
    await page.goto("http://127.0.0.1:" + server.address().port + "/index.html");
    const result = await page.evaluate(async ({ rebuild, indexOnly, shard, shards, candidate }) => {
      await LaceLocalFeatures.ready();
      const index = await (await fetch(shards > 1 || candidate ? "scripts/tmp/candidate-index.json" : "data/index.json")).json();
      if (rebuild) {
        for (let i = 0; i < index.samples.length; i += 1) {
          const s = index.samples[i];
          const f = await LaceImage.analyzeUrl(s.file);
          s.patches = f.patches; s.local = f.local; s.shape = f.shape;
          if (i % 10 === 9) console.log("test: indexed " + (i + 1) + "/" + index.samples.length);
        }
        index.version = LaceFeatures.VERSION;
        index.updated = new Date().toISOString();
      }
      if (indexOnly) return { index, version: index.version };
      async function fileAt(url) {
        const blob = await (await fetch(url)).blob();
        return new File([blob], url.split("/").pop(), { type: "image/jpeg" });
      }
      const photoFile = await fileAt("scripts/fixtures/real-photo.jpg");
      const cardFile = await fileAt("scripts/fixtures/sample-card.jpg");
      const photo = (await LaceImage.analyzeFile(photoFile)).features;
      const card = (await LaceImage.analyzeFile(cardFile)).features;
      function summary(query) {
        return LaceFeatures.rank(query, index.samples).map((r, i) => ({ id: r.sample.id, rank: i + 1, score: r.score, ...LaceFeatures.explain(query, r.sample) }));
      }
      const realRank = summary(photo), cardRank = summary(card);
      console.log("test: real-photo top " + JSON.stringify(realRank.slice(0, 3)));
      const photo2File = await fileAt("scripts/fixtures/real-photo-2.jpg");
      const photo2 = (await LaceImage.analyzeFile(photo2File)).features;
      const card2 = (await LaceImage.analyzeFile(await fileAt("scripts/fixtures/sample-card-2.jpg"))).features;
      const real2Rank = summary(photo2), card2Rank = summary(card2);
      for (const query of [photo, card, photo2, card2]) {
        if (query.region.top !== 0) throw new Error("Query preprocessing must retain the complete image");
      }
      // This also guards reuse of the candidate index after preprocessing is
      // separated by role: reference extraction must remain identical.
      for (const id of ["s060", "s067"]) {
        const reference = index.samples.find(s => s.id === id);
        const fresh = await LaceImage.analyzeUrl(reference.file);
        if (fresh.region.top <= 0 || JSON.stringify(fresh.local) !== JSON.stringify(reference.local)) {
          throw new Error("Reference labels must be excluded and the index must match current extraction: " + id);
        }
      }
      console.log("test: second real-photo top " + JSON.stringify(real2Rank.slice(0, 3)));
      // Fail early on the reported real-world failures before the expensive
      // library cross-search; the host repeats these assertions in the report.
      for (const [ranked, expected] of [[realRank, "s067"], [real2Rank, "s060"]]) {
        if (ranked[0].id !== expected || ranked[0].score < 0.65 || ranked.slice(1).some(r => r.score >= 0.5)) {
          throw new Error("Real-photo regression: " + expected + " " + JSON.stringify(ranked.slice(0, 5)));
        }
      }
      const library = [];
      // Visually reviewed variants of the same flower layout. These are valid
      // similar-pattern matches, not negative examples merely because IDs differ.
      const similarGroups = [["s012", "s013"], ["s008", "s009"], ["s016", "s017"], ["s019", "s020"], ["s021", "s022"], ["s032", "s033"], ["s062", "s063"], ["s065", "s066"], ["s086", "s087"]];
      // Each of the 90 images is used as a query against all 90 records.
      for (let i = shard; i < index.samples.length; i += shards) {
        const sample = index.samples[i];
        const uploaded = (await LaceImage.analyzeFile(await fileAt(sample.file))).features;
        const ranked = LaceFeatures.rank(uploaded, index.samples);
        const family = similarGroups.find(group => group.includes(sample.id)) || [sample.id];
        const other = ranked.find(r => !family.includes(r.sample.id));
        library.push({ id: sample.id, winner: ranked[0].sample.id, selfScore: ranked.find(r => r.sample.id === sample.id).score, strongestOther: ranked.find(r => r.sample.id !== sample.id).score, otherId: ranked.find(r => r.sample.id !== sample.id).sample.id, strongestDifferent: other.score, differentId: other.sample.id });
        if (library.length % 5 === 0) console.log("test: shard " + shard + " library queries " + library.length + "/" + Math.ceil(index.samples.length / shards));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const bitmap = await createImageBitmap(photoFile);
      async function transformed(name, fn) {
        const canvas = document.createElement("canvas");
        canvas.width = 600; canvas.height = 900;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 900);
        fn(ctx, bitmap);
        const f = await LaceFeatures.fromImageData(ctx.getImageData(0, 0, 600, 900));
        const ranked = summary(f);
        return { name, top: ranked.slice(0, 3), target: ranked.find(r => r.id === "s067") };
      }
      const variants = [];
      variants.push(await transformed("partial", (ctx, im) => ctx.drawImage(im, im.width * 0.15, im.height * 0.2, im.width * 0.7, im.height * 0.65, 0, 0, 600, 900)));
      variants.push(await transformed("rotation8", (ctx, im) => { ctx.translate(300, 450); ctx.rotate(8 * Math.PI / 180); ctx.drawImage(im, -300, -450, 600, 900); }));
      variants.push(await transformed("grayscale", (ctx, im) => { ctx.filter = "grayscale(1)"; ctx.drawImage(im, 0, 0, 600, 900); }));
      bitmap.close();
      const bitmap2 = await createImageBitmap(photo2File), repeatVariants = [];
      for (const [name, x, fraction] of [["left-half", 0, 0.5], ["right-half", 0.5, 0.5], ["middle-third", 1 / 3, 1 / 3]]) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap2.width * fraction); canvas.height = bitmap2.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap2, bitmap2.width * x, 0, bitmap2.width * fraction, bitmap2.height, 0, 0, canvas.width, canvas.height);
        const f = await LaceFeatures.fromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        const ranked = summary(f);
        repeatVariants.push({ name, top: ranked.slice(0, 3), target: ranked.find(r => r.id === "s060") });
        console.log("test: " + name + " " + JSON.stringify(repeatVariants.at(-1).target));
      }
      bitmap2.close();
      const blank = await LaceFeatures.extractFeaturesFromGray(new Uint8Array(320 * 320).fill(200), 320, 320);
      const blankMax = Math.max(...LaceFeatures.rank(blank, index.samples).map(r => r.score));
      return { index: rebuild ? index : null, version: index.version, realRank, cardRank, real2Rank, card2Rank, library, variants, repeatVariants, blankMax, regions: { photo: photo.region, card: card.region, photo2: photo2.region, card2: card2.region } };
    }, { rebuild, indexOnly, shard, shards, candidate });
    fs.mkdirSync(path.join(root, "scripts/tmp"), { recursive: true });
    if (indexOnly) {
      assert.equal(result.version, 5);
      assert.equal(result.index.samples.length, 90);
      fs.writeFileSync(path.join(root, "scripts/tmp/candidate-index.json"), JSON.stringify(result.index));
      console.log("Candidate index prepared for sharded regression; published index unchanged.");
      return;
    }
    const report = { ...result }; delete report.index;
    fs.writeFileSync(path.join(root, "scripts/tmp", shards > 1 ? "library-results-shard-" + shard + ".json" : "library-results.json"), JSON.stringify(report, null, 2));
    assert.equal(result.version, 5, "index must match algorithm version");
    assert.equal(result.real2Rank[0].id, "s060", "new real photo must rank its sample first");
    assert.equal(result.card2Rank[0].id, "s060");
    assert(result.real2Rank[0].score >= 0.65, "new photo must have substantial matching evidence");
    assert(result.real2Rank.slice(1).every(r => r.score < 0.5), "other motifs must not become strong matches for the new photo");
    assert(result.real2Rank[0].score - result.real2Rank[1].score >= 0.2);
    assert(result.repeatVariants.every(r => r.target.rank === 1 && r.target.score >= 0.5), "halves and thirds of the new photo must retrieve the correct motif");
    assert.equal(result.realRank[0].id, "s067", "real photo must rank the correct sample first");
    assert(result.realRank[0].score >= 0.65, "correct sample must pass default threshold");
    assert(result.realRank.slice(1).every(r => r.score < 0.5), "other real-photo candidates must remain below the default threshold");
    assert(result.realRank[0].score - result.realRank[1].score >= 0.2, "correct sample must have a clear margin");
    assert.equal(result.cardRank[0].id, "s067");
    // Re-encoding low-contrast JPEGs can reduce keypoint support. A score is
    // evidence strength, so test retrieval and the margin over other motifs.
    assert(result.library.every(r => r.winner === r.id && r.selfScore >= 0.65 && r.selfScore - r.strongestDifferent >= 0.2), "all library images must retrieve themselves with a clear margin over different motifs");
    assert(result.library.every(r => r.strongestDifferent < 0.5), "different library motifs must remain below the default threshold");
    // Removing hue can remove foreground/background contrast as well. The
    // Top 10 no longer filters at 50%: require actual geometric support and a
    // clear ranking margin, while keeping weak evidence honestly scored.
    assert(result.variants.every(r => r.target.rank === 1 && r.target.verified && r.target.score >= 0.25 && r.target.score - r.top[1].score >= 0.2), "partial, rotated and grayscale photos must retrieve the correct sample with verified support and a clear margin");
    assert.equal(result.blankMax, 0, "blank images must not match");
    assert.equal(errors.length, 0, errors.join("\n"));
    if (rebuild) fs.writeFileSync(path.join(root, "data/index.json"), JSON.stringify(result.index, null, 2) + "\n");
    console.log(JSON.stringify({ real: result.realRank.slice(0, 3), real2: result.real2Rank.slice(0, 3), libraryTop1: result.library.filter(r => r.winner === r.id).length, total: result.library.length, variants: result.variants, repeatVariants: result.repeatVariants, blankMax: result.blankMax }, null, 2));
    if (rebuild) console.log("Index rebuilt and saved after regression checks.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
