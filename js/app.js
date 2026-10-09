(function () {
  const PREFS_KEY = "lace-search-prefs";
  const countInput = document.querySelector("#count");
  const thresholdInput = document.querySelector("#threshold");
  const countVal = document.querySelector("#countVal");
  const thresholdVal = document.querySelector("#thresholdVal");
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
    return Math.max(0, Math.min(100, Math.round(score * 100)));
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

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (saved.count >= 5 && saved.count <= 20) countInput.value = String(saved.count);
      if (saved.threshold >= 0 && saved.threshold <= 100) thresholdInput.value = String(saved.threshold);
    } catch (err) { /* 偏好损坏时使用默认值 */ }
    updateSliderLabels();
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      count: Number(countInput.value),
      threshold: Number(thresholdInput.value)
    }));
  }

  function updateSliderLabels() {
    countVal.textContent = countInput.value;
    thresholdVal.textContent = thresholdInput.value + "%";
  }

  function renderLibraryMeta() {
    const samples = samplesOf(state.index);
    libCount.textContent = samples.length + " 件样品";
    libMeta.textContent = formatUpdated(state.index.updated);
    if (state.index.version !== LaceFeatures.VERSION && samples.length) {
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
    resultsHint.textContent = "顶部约 15% 的文字区域不会参与比对。";
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
    const count = Number(countInput.value);
    const threshold = Number(thresholdInput.value);
    const ranked = state.ranked || [];
    const visible = ranked.filter(function (item) {
      return percent(item.score) >= threshold;
    }).slice(0, count);
    const hiddenByThreshold = ranked.filter(function (item) {
      return percent(item.score) < threshold;
    }).length;

    if (!ranked.length) {
      resultsTitle.textContent = "样品库是空的";
      resultsHint.textContent = "请先到管理页面上传花边样品，再回来检索。";
      grid.replaceChildren();
      return;
    }
    if (!visible.length) {
      resultsTitle.textContent = "没有达到相似度阈值的样品";
      resultsHint.textContent = "可以把最低相似度调低一些。当前有 " + hiddenByThreshold + " 张低于 " + threshold + "%。";
      grid.replaceChildren();
      return;
    }

    resultsTitle.textContent = "最相似的 " + visible.length + " 个样品";
    resultsHint.textContent = hiddenByThreshold
      ? "已隐藏 " + hiddenByThreshold + " 张低于 " + threshold + "% 的结果。"
      : "按花纹相似度从高到低排列。";

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
          LaceUI.el("h3", { text: sample.name || "未命名" }),
          LaceUI.el("p", { class: "score" }, [
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
    if (!samples.length) {
      state.ranked = [];
      renderResults();
      return;
    }
    if (!state.ready) {
      LaceUI.toast("样品索引版本与当前页面不一致，请到管理页重新计算索引。");
      return;
    }
    state.busy = true;
    searchBtn.disabled = true;
    searchBtn.textContent = "正在比对花纹…";
    try {
      const analyzed = await LaceImage.analyzeFile(state.file);
      state.ranked = LaceFeatures.rank(analyzed.features, samples);
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
  countInput.addEventListener("input", function () {
    updateSliderLabels();
    savePrefs();
    if (state.ranked) renderResults();
  });
  thresholdInput.addEventListener("input", function () {
    updateSliderLabels();
    savePrefs();
    if (state.ranked) renderResults();
  });
  viewerClose.addEventListener("click", function () { viewer.close(); });
  viewer.addEventListener("click", function (event) {
    if (event.target === viewer) viewer.close();
  });

  LaceUI.bindFileDrop({
    veilText: "松开，开始寻纹",
    onFiles: function (files) { setQueryFile(files[0], files.length > 1); }
  });

  loadPrefs();
  loadIndex().catch(function () {
    libCount.textContent = "样品库不可用";
    libMeta.textContent = "请稍后再刷新";
    LaceUI.toast("暂时没有读到样品库，请稍后再试。");
  });
})();
