const fs = require("fs"), http = require("http"), path = require("path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end(); return; }
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) || path.relative(root, file).split(path.sep).some(segment => segment.startsWith("."))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => { if (error) { res.writeHead(404).end(); return; } res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); res.end(bytes); });
});
server.listen(Number(process.env.PORT) || 8080, "127.0.0.1", () => console.log("Local preview: http://127.0.0.1:" + server.address().port + "/"));
