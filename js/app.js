(function () {
  const RESULT_COUNT = 10;
  const dropzone = document.querySelector("#dropzone");
  const fileInput = document.querySelector("#file");
  const preview = document.querySelector("#preview");
  const previewImg = document.querySelector("#previewImg");
  const fileName = document.querySelector("#fileName");
  const searchBtn = document.querySelector("#search");
  const clearBtn = document.querySelector("#clear");
  const browseBtn = document.querySelector("#browse");
  const reloadBtn = document.querySelector("#reload");
  const libCount = document.querySelector("#libCount");
  const libMeta = document.querySelector("#libMeta");
  const resultsTitle = document.querySelector("#resultsTitle");
  const resultsHint = document.querySelector("#resultsHint");
  const grid = document.querySelector("#grid");
  const viewer = document.querySelector("#viewer");
  const viewerImg = document.querySelector("#viewerImg");
  const viewerName = document.querySelector("#viewerName");
  const viewerScore = document.querySelector("#viewerScore");
  const viewerClose = document.querySelector("#viewerClose");

  const state = {
    file: null,
    previewUrl: "",
    ranked: null,
    index: { version: LaceFeatures.VERSION, updated: null, samples: [] },
    ready: false,
    busy: false
  };

  function percent(score) {
    return Math.max(0, Math.min(100, Math.round(score * 1000) / 10));
  }

  function formatUpdated(iso) {
    if (!iso) return "还没有上传过样品";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "索引时间未知";
    return "索引更新于 " + date.toLocaleString("zh-CN", { hour12: false });
  }

  function samplesOf(index) {
    return (index.samples || []).filter(function (sample) {
      return LacePaths.isSampleFile(sample.file) && LaceFeatures.usableSample(sample);
    });
  }

  function renderLibraryMeta() {
    const samples = samplesOf(state.index);
    libCount.textContent = samples.length + " 件样品";
    libMeta.textContent = formatUpdated(state.index.updated);
    if (state.index.version !== LaceFeatures.VERSION && (state.index.samples || []).length) {
      libCount.textContent = state.index.samples.length + " 件样品（待重建索引）";
      libMeta.textContent = "索引版本需要在管理页重新计算";
    }
  }

  async function loadIndex() {
    const response = await fetch("data/index.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("没有读到样品库");
    const index = await response.json();
    state.index = index;
    state.ready = index.version === LaceFeatures.VERSION;
    renderLibraryMeta();
  }

  function resetResultsCopy() {
    resultsTitle.textContent = "等待一张花边";
    resultsHint.textContent = "放入图片后，会按花纹相似度排出最接近的样品。";
    grid.replaceChildren();
  }

  function setQueryFile(file, extra) {
    if (!file) return;
    if (!LaceImage.isSupported(file)) {
      LaceUI.toast("请上传 JPG 或 PNG 图片。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      LaceUI.toast("图片超过 20MB，请先缩小后再试。");
      return;
    }
    if (extra) LaceUI.toast("一次检索一张图片，已使用第一张。");
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = file;
    state.previewUrl = URL.createObjectURL(file);
    state.ranked = null;
    previewImg.src = state.previewUrl;
    previewImg.alt = "待检索的花边：" + file.name;
    fileName.textContent = file.name;
    dropzone.hidden = true;
    preview.hidden = false;
    resetResultsCopy();
    resultsHint.textContent = "输入图片完整保留，样本库索引排除顶部文字。";
  }

  function clearQuery() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = null;
    state.previewUrl = "";
    state.ranked = null;
    previewImg.removeAttribute("src");
    preview.hidden = true;
    dropzone.hidden = false;
    resetResultsCopy();
  }

  function openViewer(sample, score) {
    viewerImg.src = sample.file;
    viewerImg.alt = sample.name || "样品";
    viewerName.textContent = sample.name || "未命名";
    viewerScore.textContent = "相似度 " + percent(score) + "%";
    viewer.showModal();
  }

  function renderResults() {
    const ranked = state.ranked || [];
    const visible = ranked.slice(0, RESULT_COUNT);

    if (!ranked.length) {
      resultsTitle.textContent = "样品库是空的";
      resultsHint.textContent = "请先到管理页面上传花边样品，再回来检索。";
      grid.replaceChildren();
      return;
    }
    resultsTitle.textContent = "花纹相似度 Top " + visible.length;
    resultsHint.textContent = ranked[0].score >= 0.5
      ? "按相似度排列，始终展示前 10 个候选。低分结果需人工核对。"
      : "本次匹配证据较弱，展示前 10 个候选供核对；分数不代表同款概率。";
    if (ranked.length > 1 && ranked[1].score >= 0.5 && ranked[0].score - ranked[1].score < 0.1) {
      resultsHint.textContent = "前两项花纹接近，请结合品号和局部细节核对；相似度不代表同款概率。";
    }

    const fragment = document.createDocumentFragment();
    visible.forEach(function (item, index) {
      const score = percent(item.score);
      const sample = item.sample;
      const button = LaceUI.el("button", {
        type: "button",
        class: "card-open",
        onclick: function () { openViewer(sample, item.score); }
      }, [
        LaceUI.el("img", {
          src: sample.file,
          alt: sample.name || "样品",
          loading: "lazy"
        })
      ]);
      const card = LaceUI.el("article", { class: "card" }, [
        LaceUI.el("p", { class: "rank", text: String(index + 1).padStart(2, "0") }),
        button,
        LaceUI.el("div", { class: "card-meta" }, [
          LaceUI.el("h3", { text: sample.name || "未命名", title: sample.name || "未命名" }),
          LaceUI.el("p", { class: "match-status", text: item.score >= 0.65 ? "花纹对应较强" : item.score >= 0.5 ? "有局部花纹对应" : "证据不足，待核对" }),
          LaceUI.el("p", { class: "score" }, [
            LaceUI.el("span", { class: "score-label", text: "相似度" }),
            LaceUI.el("span", { class: "score-num", text: String(score) }),
            LaceUI.el("span", { class: "score-unit", text: "%" })
          ]),
          LaceUI.el("div", { class: "meter", "aria-hidden": "true" }, [
            LaceUI.el("span", { style: "width:" + score + "%" })
          ])
        ])
      ]);
      fragment.append(card);
    });
    grid.replaceChildren(fragment);
  }

  async function search() {
    if (state.busy) return;
    if (!state.file) {
      LaceUI.toast("请先放入一张花边图片。");
      return;
    }
    const samples = samplesOf(state.index);
    if (!state.ready && (state.index.samples || []).length) {
      LaceUI.toast("样品索引版本与当前页面不一致，请到管理页重新计算索引。");
      return;
    }
    if (!samples.length) {
      state.ranked = [];
      renderResults();
      return;
    }
    if (!state.ready) {
      LaceUI.toast("样品索引版本与当前页面不一致，请到管理页重新计算索引。");
      return;
    }
    const queryFile = state.file;
    const queryIndex = state.index;
    state.busy = true;
    searchBtn.disabled = true;
    searchBtn.textContent = "正在比对花纹…";
    try {
      const analyzed = await LaceImage.analyzeFile(queryFile);
      const ranked = await LaceFeatures.rankAsync(analyzed.features, samples, function (done, total) {
        searchBtn.textContent = "正在比对花纹 " + done + " / " + total;
      });
      if (state.file !== queryFile || state.index !== queryIndex) return;
      state.ranked = ranked;
      renderResults();
    } catch (err) {
      LaceUI.toast(err.message || "比对失败，请换一张图片再试。");
    } finally {
      state.busy = false;
      searchBtn.disabled = false;
      searchBtn.textContent = "寻找相似花纹";
    }
  }

  dropzone.addEventListener("click", function (event) {
    if (event.target.closest("button")) return;
    fileInput.click();
  });
  browseBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    const file = fileInput.files && fileInput.files[0];
    if (file) setQueryFile(file, fileInput.files.length > 1);
    fileInput.value = "";
  });
  clearBtn.addEventListener("click", clearQuery);
  searchBtn.addEventListener("click", search);
  reloadBtn.addEventListener("click", function () {
    loadIndex().then(function () {
      state.ranked = null;
      resetResultsCopy();
      LaceUI.toast("样品库已刷新。");
    }).catch(function () {
      LaceUI.toast("暂时没有读到样品库，请稍后再试。");
    });
  });
  viewerClose.addEventListener("click", function () { viewer.close(); });
  viewer.addEventListener("click", function (event) {
    if (event.target === viewer) viewer.close();
  });

  LaceUI.bindFileDrop({
    veilText: "松开，开始寻纹",
    onFiles: function (files) { setQueryFile(files[0], files.length > 1); }
  });

  loadIndex().catch(function () {
    libCount.textContent = "样品库不可用";
    libMeta.textContent = "请稍后再刷新";
    LaceUI.toast("暂时没有读到样品库，请稍后再试。");
  });
})();
