(function () {
  const TOKEN_KEY = "lace-admin-token";
  const MAX_BATCH = 40;
  const tokenInput = document.querySelector("#token");
  const toggleToken = document.querySelector("#toggleToken");
  const connectBtn = document.querySelector("#connect");
  const disconnectBtn = document.querySelector("#disconnect");
  const statusEl = document.querySelector("#status");
  const fileInput = document.querySelector("#file");
  const browseBtn = document.querySelector("#browse");
  const dropzone = document.querySelector("#dropzone");
  const queueEl = document.querySelector("#queue");
  const uploadBtn = document.querySelector("#upload");
  const filterInput = document.querySelector("#filter");
  const libraryEl = document.querySelector("#library");
  const libCount = document.querySelector("#libCount");
  const saveNamesBtn = document.querySelector("#saveNames");
  const rebuildBtn = document.querySelector("#rebuild");
  const progress = document.querySelector("#progress");
  const progressBar = document.querySelector("#progressBar");
  const progressText = document.querySelector("#progressText");

  const state = {
    token: "",
    connected: false,
    login: "",
    index: LaceGitHub.emptyIndex(),
    queue: [],
    busy: false
  };

  function createId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function setStatus(on, text) {
    statusEl.dataset.state = on ? "on" : "off";
    statusEl.textContent = text;
  }

  function setProgress(text, ratio) {
    progress.hidden = false;
    progressText.textContent = text;
    if (ratio == null) {
      progressBar.style.width = "36%";
      progressBar.classList.add("is-busy");
    } else {
      progressBar.classList.remove("is-busy");
      progressBar.style.width = Math.round(ratio * 100) + "%";
    }
  }

  function clearProgress() {
    progress.hidden = true;
    progressBar.classList.remove("is-busy");
    progressBar.style.width = "0%";
  }

  function setBusy(on) {
    state.busy = on;
    document.querySelectorAll("[data-busy]").forEach(function (node) {
      if (on || node.id !== "upload") node.disabled = on;
    });
    if (!on) renderQueue();
  }

  function imageSrc(sample) {
    if (state.connected) return LaceGitHub.rawUrl(sample.file, state.index.updated);
    return sample.file;
  }

  function renderQueue() {
    queueEl.replaceChildren();
    if (!state.queue.length) {
      queueEl.hidden = true;
      uploadBtn.disabled = true;
      return;
    }
    queueEl.hidden = false;
    uploadBtn.disabled = state.busy || !state.connected;
    state.queue.forEach(function (item) {
      const img = LaceUI.el("img", { src: item.url, alt: "" });
      const name = LaceUI.el("input", {
        type: "text",
        value: item.name,
        maxlength: "48",
        "aria-label": "品名编号"
      });
      name.addEventListener("input", function () { item.name = name.value; });
      const card = LaceUI.el("article", { class: "queue-card" }, [
        img,
        name,
        LaceUI.el("button", {
          type: "button",
          class: "btn btn-ghost",
          text: "移除",
          onclick: function () {
            URL.revokeObjectURL(item.url);
            state.queue = state.queue.filter(function (other) { return other !== item; });
            renderQueue();
          }
        })
      ]);
      queueEl.append(card);
    });
  }

  function namesDirty() {
    const inputs = libraryEl.querySelectorAll("[data-id]");
    for (let i = 0; i < inputs.length; i += 1) {
      const sample = state.index.samples.find(function (item) { return item.id === inputs[i].dataset.id; });
      if (sample && LaceImage.cleanName(inputs[i].value) !== sample.name) return true;
    }
    return false;
  }

  function renderLibrary() {
    const keyword = (filterInput.value || "").trim().toLowerCase();
    const samples = state.index.samples.filter(function (sample) {
      if (!keyword) return true;
      return String(sample.name || "").toLowerCase().indexOf(keyword) !== -1;
    });
    libCount.textContent = state.index.samples.length + " 件";
    libraryEl.replaceChildren();
    if (!state.index.samples.length) {
      libraryEl.append(LaceUI.el("p", { class: "empty-copy", text: "还没有样品。上传后，首页就能按花纹检索。" }));
      return;
    }
    if (!samples.length) {
      libraryEl.append(LaceUI.el("p", { class: "empty-copy", text: "没有符合筛选的样品。" }));
      return;
    }
    samples.forEach(function (sample) {
      const input = LaceUI.el("input", {
        type: "text",
        value: sample.name || "",
        maxlength: "48",
        "data-id": sample.id,
        "aria-label": "品名编号"
      });
      const img = LaceUI.el("img", { src: imageSrc(sample), alt: sample.name || "样品", loading: "lazy" });
      img.addEventListener("error", function () {
        img.alt = "图片还在同步，请稍后再看";
      });
      const card = LaceUI.el("article", { class: "lib-card" }, [
        LaceUI.el("div", { class: "thumb" }, [img]),
        LaceUI.el("label", { class: "field" }, [
          LaceUI.el("span", { text: "品名编号" }),
          input
        ]),
        LaceUI.el("button", {
          type: "button",
          class: "btn btn-danger",
          text: "删除",
          "data-busy": "true",
          onclick: function () { removeSample(sample); }
        })
      ]);
      libraryEl.append(card);
    });
  }

  async function refreshIndex() {
    state.index = state.connected
      ? await LaceGitHub.readIndex(state.token)
      : await loadPublicIndex();
    renderLibrary();
  }

  async function loadPublicIndex() {
    const response = await fetch("data/index.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return LaceGitHub.emptyIndex();
    const index = await response.json();
    if (!Array.isArray(index.samples)) return LaceGitHub.emptyIndex();
    index.samples = index.samples.filter(function (sample) {
      return LacePaths.isSampleFile(sample.file) && LaceFeatures.usableSample(sample);
    });
    return index;
  }

  async function connect(token) {
    const clean = String(token || "").replace(/^Bearer\s+/i, "").trim();
    if (!clean) {
      LaceUI.toast("请先粘贴访问令牌。");
      return;
    }
    setBusy(true);
    setStatus(false, "正在验证…");
    try {
      const info = await LaceGitHub.verify(clean);
      state.token = clean;
      state.connected = true;
      state.login = info.login;
      localStorage.setItem(TOKEN_KEY, clean);
      setStatus(true, "已连接 " + info.login);
      if (info.privateRepo) {
        LaceUI.toast("仓库目前是私有的，免费 GitHub Pages 无法公开访问。请把仓库设为 Public。");
      }
      await refreshIndex();
      renderQueue();
    } catch (err) {
      state.connected = false;
      if (err.status === 401) localStorage.removeItem(TOKEN_KEY);
      setStatus(false, "未连接");
      LaceUI.toast(err.message || "连接失败");
    } finally {
      setBusy(false);
      renderQueue();
    }
  }

  function disconnect() {
    state.token = "";
    state.connected = false;
    state.login = "";
    localStorage.removeItem(TOKEN_KEY);
    tokenInput.value = "";
    setStatus(false, "未连接");
    renderQueue();
    refreshIndex().catch(function () { renderLibrary(); });
  }

  function addFiles(files) {
    const accepted = [];
    Array.prototype.forEach.call(files, function (file) {
      if (!LaceImage.isSupported(file)) {
        LaceUI.toast(file.name + " 不是 JPG 或 PNG，已跳过。");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        LaceUI.toast(file.name + " 超过 20MB，已跳过。");
        return;
      }
      accepted.push(file);
    });
    const room = MAX_BATCH - state.queue.length;
    if (room <= 0) {
      LaceUI.toast("一次最多准备 " + MAX_BATCH + " 张，请先写入这一批。");
      return;
    }
    const slice = accepted.slice(0, room);
    if (accepted.length > slice.length) {
      LaceUI.toast("一次最多写入 " + MAX_BATCH + " 张，其余请分批上传。");
    }
    slice.forEach(function (file) {
      state.queue.push({
        file: file,
        name: LaceImage.nameFromFile(file),
        url: URL.createObjectURL(file)
      });
    });
    renderQueue();
  }

  async function uploadQueue() {
    if (!state.connected || state.busy) return;
    if (!state.queue.length) return;
    if (namesDirty()) {
      LaceUI.toast("有未保存的编号修改。请先保存，或先完成这次上传。");
      return;
    }
    setBusy(true);
    const pending = state.queue.slice();
    try {
      const prepared = [];
      for (let i = 0; i < pending.length; i += 1) {
        setProgress("正在计算纹理索引 " + (i + 1) + " / " + pending.length, i / pending.length);
        const item = pending[i];
        const analyzed = await LaceImage.analyzeFile(item.file);
        const id = createId();
        prepared.push({
          id: id,
          name: LaceImage.cleanName(item.name),
          file: "samples/" + id + ".jpg",
          patches: analyzed.features.patches,
          blob: analyzed.blob
        });
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
      const index = await LaceGitHub.readIndex(state.token);
      prepared.forEach(function (item) {
        index.samples.push({
          id: item.id,
          name: item.name,
          file: item.file,
          patches: item.patches
        });
      });
      index.version = LaceFeatures.VERSION;
      index.updated = new Date().toISOString();
      const files = [];
      for (let i = 0; i < prepared.length; i += 1) {
        files.push({
          path: prepared[i].file,
          base64: await LaceGitHub.blobToBase64(prepared[i].blob),
          label: "正在上传图片 " + (i + 1) + " / " + prepared.length
        });
      }
      files.push({
        path: window.LACE_CONFIG.indexPath,
        text: JSON.stringify(index, null, 2),
        label: "正在更新索引"
      });
      await LaceGitHub.commitFiles(state.token, {
        message: prepared.length === 1
          ? "添加样品 " + prepared[0].name
          : "添加 " + prepared.length + " 个花边样品",
        files: files,
        onProgress: setProgress
      });
      pending.forEach(function (item) { URL.revokeObjectURL(item.url); });
      state.queue = [];
      renderQueue();
      await refreshIndex();
      LaceUI.toast("已写入云端。公开页面通常会在一两分钟内更新。");
    } catch (err) {
      LaceUI.toast(err.message || "上传失败");
    } finally {
      clearProgress();
      setBusy(false);
      renderQueue();
    }
  }

  async function saveNames() {
    if (!state.connected || state.busy) {
      LaceUI.toast("请先连接云端，才能保存编号。");
      return;
    }
    const edits = {};
    libraryEl.querySelectorAll("[data-id]").forEach(function (input) {
      edits[input.dataset.id] = LaceImage.cleanName(input.value);
    });
    setBusy(true);
    setProgress("正在保存品名编号…", null);
    try {
      const index = await LaceGitHub.readIndex(state.token);
      let changed = 0;
      index.samples.forEach(function (sample) {
        if (!Object.prototype.hasOwnProperty.call(edits, sample.id)) return;
        if (edits[sample.id] !== sample.name) {
          sample.name = edits[sample.id];
          changed += 1;
        }
      });
      if (!changed) {
        LaceUI.toast("编号没有变化。");
        return;
      }
      index.updated = new Date().toISOString();
      index.version = LaceFeatures.VERSION;
      await LaceGitHub.commitFiles(state.token, {
        message: "更新品名编号",
        files: [{ path: window.LACE_CONFIG.indexPath, text: JSON.stringify(index, null, 2) }],
        onProgress: setProgress
      });
      await refreshIndex();
      LaceUI.toast("品名编号已更新。");
    } catch (err) {
      LaceUI.toast(err.message || "保存失败");
    } finally {
      clearProgress();
      setBusy(false);
    }
  }

  async function removeSample(sample) {
    if (!state.connected) {
      LaceUI.toast("请先连接云端，才能删除样品。");
      return;
    }
    if (state.busy) return;
    const ok = await LaceUI.confirm("确定从样品库删除「" + (sample.name || "未命名") + "」？图片和索引都会从云端移除。");
    if (!ok) return;
    setBusy(true);
    setProgress("正在删除样品…", null);
    try {
      const index = await LaceGitHub.readIndex(state.token);
      index.samples = index.samples.filter(function (item) { return item.id !== sample.id; });
      index.updated = new Date().toISOString();
      index.version = LaceFeatures.VERSION;
      await LaceGitHub.commitFiles(state.token, {
        message: "删除样品 " + (sample.name || sample.id),
        files: [{ path: window.LACE_CONFIG.indexPath, text: JSON.stringify(index, null, 2) }],
        deletions: [sample.file],
        onProgress: setProgress
      });
      await refreshIndex();
      LaceUI.toast("已从云端删除。");
    } catch (err) {
      LaceUI.toast(err.message || "删除失败");
    } finally {
      clearProgress();
      setBusy(false);
    }
  }

  async function rebuild() {
    if (!state.connected || state.busy) {
      LaceUI.toast("请先连接云端。");
      return;
    }
    if (!state.index.samples.length) {
      LaceUI.toast("样品库是空的，无需重新计算。");
      return;
    }
    const ok = await LaceUI.confirm("将根据云端图片重新计算全部纹理索引。样品较多时会需要几分钟。");
    if (!ok) return;
    setBusy(true);
    try {
      const index = await LaceGitHub.readIndex(state.token);
      for (let i = 0; i < index.samples.length; i += 1) {
        const sample = index.samples[i];
        setProgress("正在重新计算 " + (i + 1) + " / " + index.samples.length, i / index.samples.length);
        const features = await LaceImage.analyzeUrl(LaceGitHub.rawUrl(sample.file, String(Date.now())));
        sample.patches = features.patches;
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
      index.version = LaceFeatures.VERSION;
      index.updated = new Date().toISOString();
      await LaceGitHub.commitFiles(state.token, {
        message: "重新计算纹理索引",
        files: [{ path: window.LACE_CONFIG.indexPath, text: JSON.stringify(index, null, 2) }],
        onProgress: setProgress
      });
      await refreshIndex();
      LaceUI.toast("索引已重新计算并写入云端。");
    } catch (err) {
      LaceUI.toast(err.message || "重新计算失败");
    } finally {
      clearProgress();
      setBusy(false);
    }
  }

  toggleToken.addEventListener("click", function () {
    const show = tokenInput.type === "password";
    tokenInput.type = show ? "text" : "password";
    toggleToken.textContent = show ? "隐藏" : "显示";
  });
  connectBtn.addEventListener("click", function () { connect(tokenInput.value); });
  disconnectBtn.addEventListener("click", disconnect);
  browseBtn.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("click", function (event) {
    if (event.target.closest("button")) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = "";
  });
  uploadBtn.addEventListener("click", uploadQueue);
  saveNamesBtn.addEventListener("click", saveNames);
  rebuildBtn.addEventListener("click", rebuild);
  filterInput.addEventListener("input", renderLibrary);
  window.addEventListener("beforeunload", function (event) {
    if (!state.busy) return;
    event.preventDefault();
    event.returnValue = "";
  });

  LaceUI.bindFileDrop({
    veilText: "松开，加入样品库",
    onFiles: addFiles
  });

  const saved = localStorage.getItem(TOKEN_KEY) || "";
  if (saved) {
    tokenInput.value = saved;
    connect(saved);
  } else {
    setStatus(false, "未连接");
    refreshIndex().catch(function () { renderLibrary(); });
  }
  renderQueue();
})();
