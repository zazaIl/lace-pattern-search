(function () {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach(function (key) {
      const value = props[key];
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value == null ? "" : String(value);
      else if (key === "hidden") node.hidden = Boolean(value);
      else if (key === "value") node.value = value;
      else if (key.indexOf("on") === 0 && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else if (value != null) node.setAttribute(key, value);
    });
    (children || []).forEach(function (child) {
      if (child) node.append(child);
    });
    return node;
  }

  function toastHost() {
    let host = document.querySelector(".toasts");
    if (!host) {
      host = el("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.append(host);
    }
    return host;
  }

  function toast(message) {
    const node = el("div", { class: "toast", text: message });
    toastHost().append(node);
    setTimeout(function () {
      node.classList.add("is-leaving");
      setTimeout(function () { node.remove(); }, 280);
    }, 4600);
  }

  function confirmDialog(message) {
    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (value) {
        if (settled) return;
        settled = true;
        dialog.close();
        dialog.remove();
        resolve(value);
      };
      const dialog = el("dialog", { class: "confirm" }, [
        el("p", { class: "confirm-text", text: message }),
        el("div", { class: "confirm-actions" }, [
          el("button", { type: "button", class: "btn btn-ghost", text: "取消", onclick: function () { finish(false); } }),
          el("button", { type: "button", class: "btn btn-primary", text: "确认", onclick: function () { finish(true); } })
        ])
      ]);
      dialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        finish(false);
      });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  function hasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, "Files") !== -1;
  }

  function bindFileDrop(options) {
    const onFiles = options.onFiles;
    let depth = 0;
    let veil = document.querySelector(".veil");
    if (!veil) {
      veil = el("div", { class: "veil", hidden: true }, [
        el("p", { text: options.veilText || "松开，开始寻纹" })
      ]);
      document.body.append(veil);
    }

    function hide() {
      depth = 0;
      veil.hidden = true;
      const zone = document.querySelector(".dropzone");
      if (zone) zone.classList.remove("is-over");
    }

    document.addEventListener("dragenter", function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      veil.hidden = false;
      const zone = document.querySelector(".dropzone");
      if (zone) zone.classList.add("is-over");
    });
    document.addEventListener("dragover", function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", function () {
      depth -= 1;
      if (depth <= 0) hide();
    });
    document.addEventListener("drop", function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const files = event.dataTransfer ? Array.prototype.slice.call(event.dataTransfer.files || []) : [];
      hide();
      if (files.length) onFiles(files);
    });
  }

  window.LaceUI = {
    el: el,
    toast: toast,
    confirm: confirmDialog,
    bindFileDrop: bindFileDrop
  };
})();
