const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert/strict");
const { chromium } = require(process.env.LACE_NODE_MODULES ? path.join(process.env.LACE_NODE_MODULES, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (e, b) => { if (e) { res.writeHead(404).end(); return; } const types = { ".js": "application/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" }; res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); res.end(b); });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.LACE_BROWSER ? { executablePath: process.env.LACE_BROWSER } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors = []; page.on("pageerror", e => errors.push(String(e)));
    if (process.argv.includes("--candidate")) {
      const body = fs.readFileSync(path.join(root, "scripts/tmp/candidate-index.json"), "utf8");
      await page.route("**/data/index.json*", route => route.fulfill({ contentType: "application/json", body }));
    }
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base + "/index.html");
    await page.waitForFunction(() => document.querySelector("#libCount").textContent.includes("90"));
    await page.evaluate(() => localStorage.setItem("lace-search-prefs", JSON.stringify({ count: 5, threshold: 100 })));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#libCount").textContent.includes("90"));
    await page.locator("#file").setInputFiles(path.join(root, "scripts/fixtures/real-photo-2.jpg"));
    const start = Date.now();
    await page.locator("#search").click();
    await page.waitForFunction(() => document.querySelector("#search").disabled === false && document.querySelectorAll("#grid .card").length > 0, undefined, { timeout: 60000 });
    const elapsedMs = Date.now() - start;
    assert.equal(await page.locator("#grid .card").count(), 10, "every query must show Top 10 without filtering weak candidates");
    assert.equal(await page.locator("#grid .card img").first().getAttribute("src"), "samples/s060.jpg");
    assert.equal(await page.locator("#grid .score-num").count(), 10, "all ten candidates must show similarity");
    assert((await page.locator("#grid .match-status").nth(1).textContent()).includes("待核对"));
    const score = await page.locator("#grid .score-num").first().textContent();
    const screenshot = path.join(root, "scripts/tmp/search-result.png");
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile results must not overflow");
    assert(await page.evaluate(() => [...document.querySelectorAll("#grid h3")].every(el => el.scrollWidth <= el.clientWidth)), "long sample names must stay inside their cards");
    await page.screenshot({ path: path.join(root, "scripts/tmp/search-result-mobile.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 950 });
    await page.locator("#file").setInputFiles(path.join(root, "scripts/fixtures/real-photo.jpg"));
    await page.locator("#search").click();
    await page.waitForFunction(() => document.querySelector("#search").disabled === false && document.querySelectorAll("#grid .card").length === 10, undefined, { timeout: 60000 });
    assert.equal(await page.locator("#grid .card img").first().getAttribute("src"), "samples/s067.jpg");
    const special = [];
    for (const [name, expected, maxRank] of [["circular-photo.png", "s003", 2], ["sparse-photo.png", "s015", 1]]) {
      await page.locator("#file").setInputFiles(path.join(root, "scripts/fixtures/" + name));
      const started = Date.now();
      await page.locator("#search").click();
      await page.waitForFunction(() => !document.querySelector("#search").disabled && document.querySelectorAll("#grid .card").length === 10, undefined, { timeout: 60000 });
      const cards = await page.locator("#grid .card").evaluateAll(nodes => nodes.map(el => ({ src: el.querySelector("img").getAttribute("src"), score: Number(el.querySelector(".score-num").textContent) })));
      const rank = cards.findIndex(r => r.src === "samples/" + expected + ".jpg") + 1;
      assert(rank > 0 && rank <= maxRank, name + " must retrieve its target at the front");
      assert(cards[rank-1].score >= 50, name + " needs geometric evidence");
      const allowed = expected === "s003" ? ["s003", "s025"] : [expected];
      assert(cards.filter(r => !allowed.some(id => r.src === "samples/"+id+".jpg")).every(r => r.score < 50), name + " must not strongly match other motifs");
      special.push({ name, rank, score: cards[rank-1].score, elapsedMs: Date.now()-started });
      await page.screenshot({ path: path.join(root, "scripts/tmp/" + name + "-results.png"), fullPage: true, animations: "disabled" });
    }
    await page.locator("#search").click();
    await page.locator("#file").setInputFiles(path.join(root, "scripts/fixtures/sample-card.jpg"));
    await page.waitForFunction(() => document.querySelector("#search").disabled === false, undefined, { timeout: 60000 });
    assert.equal(await page.locator("#grid .card").count(), 0, "changing the query during search must discard stale results");
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile layout must not overflow");
    await page.goto(base + "/admin.html");
    await page.waitForFunction(() => document.querySelectorAll(".lib-card").length === 90);
    const oldIndex = JSON.parse(fs.readFileSync(path.join(root, "data/index.json"), "utf8"));
    oldIndex.version = 2; oldIndex.samples.forEach(s => delete s.local);
    await page.route("**/data/index.json?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(oldIndex) }));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".lib-card").length === 90);
    await page.goto(base + "/index.html");
    await page.waitForFunction(() => document.querySelector("#libCount").textContent.includes("待重建"));
    await page.locator("#file").setInputFiles(path.join(root, "scripts/fixtures/real-photo.jpg"));
    await page.locator("#search").click();
    assert.equal(await page.locator("#grid .card").count(), 0, "old indices must not be searched with new features");
    assert.equal(errors.length, 0, errors.join("\n"));
    const result = { special, winner: "s060", score: Number(score), visibleCandidates: 10, oldPhotoWinner: "s067", elapsedMs, desktopAndMobile: true, adminSamples: 90, oldIndexRecordsPreserved: true };
    fs.writeFileSync(path.join(root, "scripts/tmp/ui-results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
