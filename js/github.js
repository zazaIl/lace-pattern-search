(function () {
  const cfg = window.LACE_CONFIG;

  function explain(status, payload) {
    const message = (payload && payload.message) || "";
    if (status === 401) return "令牌无效或已过期，请重新生成后再粘贴。";
    if (status === 403 && /rate limit/i.test(message)) return "GitHub 接口次数已用完，请稍后再试。";
    if (status === 403) return "这个令牌不能写入样品库。请确认已授予 Contents 的读写权限。";
    if (status === 404) return "找不到仓库 " + cfg.owner + "/" + cfg.repo + "。";
    if (status === 409 || status === 422) return "云端样品库刚刚被更新，请再试一次。";
    return message ? "云端保存失败：" + message : "云端保存失败（" + status + "）。";
  }

  async function gh(token, path, options) {
    const opts = options || {};
    const res = await fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers: {
        Accept: opts.accept || "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch (err) { payload = { message: text.slice(0, 180) }; }
    }
    if (!res.ok) {
      const error = new Error(explain(res.status, payload));
      error.status = res.status;
      throw error;
    }
    return payload;
  }

  async function withRetry(fn) {
    let last;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await fn(); }
      catch (err) {
        last = err;
        if (err.status && err.status < 500 && err.status !== 429) throw err;
        await new Promise(function (resolve) { setTimeout(resolve, 700 * (attempt + 1)); });
      }
    }
    throw last;
  }

  function emptyIndex() {
    return { version: LaceFeatures.VERSION, updated: null, samples: [] };
  }

  function normalizeIndex(index) {
    const samples = Array.isArray(index && index.samples) ? index.samples : [];
    return {
      version: index && Number.isInteger(index.version) ? index.version : LaceFeatures.VERSION,
      updated: index && index.updated ? index.updated : null,
      samples: samples.filter(function (sample) {
        // Keep older feature records so the admin can rebuild them rather than
        // silently dropping the library during an algorithm upgrade.
        return sample && LacePaths.isSampleFile(sample.file);
      })
    };
  }

  async function verify(token) {
    const user = await gh(token, "/user");
    const repo = await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo);
    if (repo.permissions && repo.permissions.push === false) {
      throw new Error("这个账号只能查看样品库，不能写入。请使用有写入权限的令牌。");
    }
    return {
      login: user.login,
      privateRepo: Boolean(repo.private)
    };
  }

  async function readIndex(token) {
    try {
      const data = await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + cfg.indexPath + "?ref=" + cfg.branch, { accept: "application/vnd.github.raw+json" });
      return normalizeIndex(data);
    } catch (err) {
      if (err.status === 404) return emptyIndex();
      throw err;
    }
  }

  async function commitFiles(token, spec) {
    const onProgress = spec.onProgress || function () {};
    onProgress("正在读取云端样品库…", null);
    const refData = await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/git/ref/heads/" + cfg.branch);
    const parent = refData.object.sha;
    const commit = await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/git/commits/" + parent);
    const files = spec.files || [];
    const deletions = spec.deletions || [];
    const tree = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      onProgress(file.label || "正在上传 " + (i + 1) + " / " + files.length, (i + 1) / (files.length + 1));
      const body = file.text != null
        ? { content: file.text, encoding: "utf-8" }
        : { content: file.base64, encoding: "base64" };
      const blob = await withRetry(function () {
        return gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/git/blobs", { method: "POST", body: body });
      });
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    deletions.forEach(function (path) {
      if (!LacePaths.isSampleFile(path)) throw new Error("拒绝删除样品目录以外的文件。");
      tree.push({ path: path, mode: "100644", type: "blob", sha: null });
    });
    onProgress("正在更新索引…", 0.96);
    const nextTree = await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/git/trees", {
      method: "POST",
      body: { base_tree: commit.tree.sha, tree: tree }
    });
    const nextCommit = await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/git/commits", {
      method: "POST",
      body: { message: spec.message, tree: nextTree.sha, parents: [parent] }
    });
    await gh(token, "/repos/" + cfg.owner + "/" + cfg.repo + "/git/refs/heads/" + cfg.branch, {
      method: "PATCH",
      body: { sha: nextCommit.sha }
    });
    onProgress("已写入云端", 1);
    return nextCommit.sha;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const text = String(reader.result || "");
        resolve(text.slice(text.indexOf(",") + 1));
      };
      reader.onerror = function () { reject(new Error("读取图片失败")); };
      reader.readAsDataURL(blob);
    });
  }

  function rawUrl(path, stamp) {
    return "https://raw.githubusercontent.com/" + cfg.owner + "/" + cfg.repo + "/" + cfg.branch + "/" + path + "?t=" + encodeURIComponent(stamp || "");
  }

  window.LaceGitHub = {
    verify: verify,
    readIndex: readIndex,
    commitFiles: commitFiles,
    blobToBase64: blobToBase64,
    rawUrl: rawUrl,
    emptyIndex: emptyIndex
  };
})();
