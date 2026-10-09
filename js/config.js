window.LACE_CONFIG = Object.freeze({
  owner: "zazaIl",
  repo: "lace-pattern-search",
  branch: "main",
  indexPath: "data/index.json",
  siteUrl: "https://zazail.github.io/lace-pattern-search/"
});

window.LacePaths = {
  isSampleFile(path) {
    return typeof path === "string" && /^samples\/[a-z0-9]+\.jpg$/.test(path);
  }
};
