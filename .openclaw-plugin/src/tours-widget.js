// Floating "Tours" widget — injected into the dashboard by interactive-server.ts,
// alongside ask-widget.js. Lists/plays the auto-generated (module, code review),
// custom, and PR-walkthrough tours from GET /tours.json, and lets the user select
// node(s) in the live React Flow canvas — selection is read via the shared
// discovery in selection.js (window.uaSelection), not a private observer here —
// plus a free-text prompt to generate a new custom tour via POST /generate-tour.json,
// or a PR number/base branch to generate a diff walkthrough via POST /generate-pr-tour.json.
(function () {
  "use strict";

  var TOKEN = new URLSearchParams(window.location.search).get("token") || "";

  var STYLE = "\n" +
    "#ua-tours-fab{position:fixed;bottom:24px;right:92px;z-index:9999;width:56px;height:56px;border-radius:50%;" +
    "background:#8957e5;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;" +
    "font-size:22px;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;}\n" +
    "#ua-tours-fab:hover{background:#a371f7;}\n" +
    "#ua-tours-panel{position:fixed;bottom:92px;right:92px;z-index:9999;width:380px;max-width:calc(100vw - 48px);" +
    "height:520px;max-height:calc(100vh - 140px);background:#0d1117;color:#e6edf3;border:1px solid #30363d;" +
    "border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);display:none;flex-direction:column;" +
    "font-family:system-ui,-apple-system,sans-serif;overflow:hidden;}\n" +
    "#ua-tours-panel.open{display:flex;}\n" +
    "#ua-tours-header{padding:12px 14px;border-bottom:1px solid #30363d;font-weight:600;font-size:14px;" +
    "display:flex;justify-content:space-between;align-items:center;}\n" +
    "#ua-tours-header button{background:none;border:none;color:#8b949e;cursor:pointer;font-size:18px;}\n" +
    "#ua-tours-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}\n" +
    ".ua-tour-item{border:1px solid #30363d;border-radius:8px;padding:10px;}\n" +
    ".ua-tour-item h4{margin:0 0 4px;font-size:13px;}\n" +
    ".ua-tour-item p{margin:0 0 8px;font-size:11px;color:#8b949e;}\n" +
    ".ua-tour-item button{background:#1f6feb;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;}\n" +
    "#ua-tour-generate{border-top:1px solid #30363d;padding:10px 14px;}\n" +
    "#ua-tour-generate h4{margin:0 0 6px;font-size:13px;}\n" +
    "#ua-selection-count{font-size:11px;color:#8b949e;margin-bottom:6px;}\n" +
    "#ua-tour-prompt{width:100%;box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:8px;" +
    "color:#e6edf3;padding:8px 10px;font-size:13px;resize:none;font-family:inherit;margin-bottom:6px;}\n" +
    "#ua-tour-generate-btn{width:100%;background:#8957e5;color:#fff;border:none;border-radius:8px;padding:8px;cursor:pointer;font-size:13px;}\n" +
    "#ua-tour-generate-btn:disabled{opacity:.5;cursor:default;}\n" +
    "#ua-pr-generate{border-top:1px solid #30363d;padding:10px 14px;}\n" +
    "#ua-pr-generate h4{margin:0 0 6px;font-size:13px;}\n" +
    "#ua-pr-generate p{margin:0 0 6px;font-size:11px;color:#8b949e;}\n" +
    "#ua-pr-input{width:100%;box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:8px;" +
    "color:#e6edf3;padding:8px 10px;font-size:13px;font-family:inherit;margin-bottom:6px;}\n" +
    "#ua-pr-generate-btn{width:100%;background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:8px;cursor:pointer;font-size:13px;}\n" +
    "#ua-pr-generate-btn:disabled{opacity:.5;cursor:default;}\n" +
    "#ua-tour-player{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;" +
    "background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);" +
    "padding:14px 18px;width:460px;max-width:calc(100vw - 48px);display:none;font-family:system-ui,-apple-system,sans-serif;}\n" +
    "#ua-tour-player.open{display:block;}\n" +
    "#ua-tour-player h4{margin:0 0 4px;font-size:14px;}\n" +
    "#ua-tour-player p{margin:0 0 10px;font-size:12px;color:#8b949e;line-height:1.4;}\n" +
    "#ua-tour-player-controls{display:flex;justify-content:space-between;align-items:center;}\n" +
    "#ua-tour-player-controls button{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;" +
    "padding:4px 12px;cursor:pointer;font-size:12px;}\n" +
    "#ua-tour-player-controls button:disabled{opacity:.4;cursor:default;}\n" +
    "#ua-tour-step-count{font-size:11px;color:#8b949e;}\n" +
    ".ua-highlighted-node{outline:3px solid #f0883e !important;outline-offset:2px;}\n";

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) {
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function authedFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, { "X-Ask-Token": TOKEN });
    return fetch(url, options);
  }

  // --- Live selection tracking — reads the shared discovery in selection.js
  // (window.uaSelection) instead of running its own MutationObserver; Ask uses
  // the same source, so both widgets always agree on "what's selected".
  function getSelectedNodeIds() {
    return window.uaSelection ? window.uaSelection.get() : [];
  }
  function renderSelectionCount(ids) {
    var countEl = document.getElementById("ua-selection-count");
    if (!countEl) return;
    countEl.textContent = ids.length === 0
      ? "No nodes selected in the graph — click one or more to scope a custom tour."
      : ids.length + " node(s) selected: " + ids.slice(0, 3).join(", ") + (ids.length > 3 ? "…" : "");
  }

  function highlightNodes(nodeIds) {
    document.querySelectorAll(".ua-highlighted-node").forEach(function (n) { n.classList.remove("ua-highlighted-node"); });
    (nodeIds || []).forEach(function (id) {
      var el = document.querySelector('.react-flow__node[data-id="' + CSS.escape(id) + '"]');
      if (el) el.classList.add("ua-highlighted-node");
    });
  }

  // --- Tour player ---
  var currentTour = null;
  var currentStep = 0;

  function renderPlayerStep() {
    if (!currentTour) return;
    var step = currentTour.steps[currentStep];
    document.getElementById("ua-tour-player-title").textContent = step.title;
    document.getElementById("ua-tour-player-desc").textContent = step.description;
    document.getElementById("ua-tour-step-count").textContent = (currentStep + 1) + " / " + currentTour.steps.length;
    document.getElementById("ua-tour-prev").disabled = currentStep === 0;
    document.getElementById("ua-tour-next").disabled = currentStep === currentTour.steps.length - 1;
    highlightNodes(step.nodeIds);
  }

  function playTour(tour) {
    if (!tour.steps || tour.steps.length === 0) return;
    currentTour = tour;
    currentStep = 0;
    document.getElementById("ua-tours-panel").classList.remove("open");
    document.getElementById("ua-tour-player").classList.add("open");
    renderPlayerStep();
  }

  function closePlayer() {
    document.getElementById("ua-tour-player").classList.remove("open");
    highlightNodes([]);
    currentTour = null;
  }

  // --- Tour list ---
  function tourItemEl(tour) {
    var item = el("div", { class: "ua-tour-item" });
    item.appendChild(el("h4", {}, [tour.title + " (" + tour.steps.length + " steps)"]));
    item.appendChild(el("p", {}, [tour.description || ""]));
    var playBtn = el("button", {}, ["Play"]);
    playBtn.addEventListener("click", function () { playTour(tour); });
    item.appendChild(playBtn);
    return item;
  }

  function loadTours() {
    return authedFetch("/tours.json").then(function (res) { return res.json(); }).then(function (data) { return data.tours || []; });
  }

  function renderTourList() {
    var body = document.getElementById("ua-tours-body");
    body.innerHTML = "";
    loadTours().then(function (tours) {
      if (tours.length === 0) {
        body.appendChild(el("p", { style: "color:#8b949e;font-size:13px;" }, ["No tours yet."]));
        return;
      }
      tours.forEach(function (tour) { body.appendChild(tourItemEl(tour)); });
    });
  }

  // --- Generate custom tour ---
  function generateTour() {
    var input = document.getElementById("ua-tour-prompt");
    var btn = document.getElementById("ua-tour-generate-btn");
    var prompt = input.value.trim();
    if (!prompt) return;
    btn.disabled = true;
    btn.textContent = "Generating…";

    authedFetch("/generate-tour.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeIds: getSelectedNodeIds(), prompt: prompt }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      })
      .then(function (data) {
        input.value = "";
        renderTourList();
        if (data.tour) playTour(data.tour);
      })
      .catch(function (err) {
        alert("Could not generate tour: " + err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Generate custom tour";
      });
  }

  // --- Generate PR/diff walkthrough ---
  function generatePrTour() {
    var input = document.getElementById("ua-pr-input");
    var btn = document.getElementById("ua-pr-generate-btn");
    var raw = input.value.trim();
    if (!raw) return;
    var isPrNumber = /^\d+$/.test(raw);
    var body = isPrNumber ? { prNumber: Number(raw) } : { baseBranch: raw };

    btn.disabled = true;
    btn.textContent = "Generating…";

    authedFetch("/generate-pr-tour.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      })
      .then(function (data) {
        input.value = "";
        renderTourList();
        if (data.tour) playTour(data.tour);
      })
      .catch(function (err) {
        alert("Could not generate PR walkthrough: " + err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Generate PR walkthrough";
      });
  }

  function init() {
    if (!TOKEN) return; // no token in URL — not a live session

    var style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    var fab = el("button", { id: "ua-tours-fab", title: "Tours" }, ["🧭"]);
    var panel = el("div", { id: "ua-tours-panel" });
    var header = el("div", { id: "ua-tours-header" }, [
      "Tours",
      el("button", { id: "ua-tours-close" }, ["×"]),
    ]);
    var body = el("div", { id: "ua-tours-body" });
    var generate = el("div", { id: "ua-tour-generate" }, [
      el("h4", {}, ["Generate a custom tour"]),
      el("div", { id: "ua-selection-count" }, ["No nodes selected in the graph — click one or more to scope a custom tour."]),
      el("textarea", { id: "ua-tour-prompt", rows: "2", placeholder: "e.g. walk me through the request lifecycle" }),
      el("button", { id: "ua-tour-generate-btn" }, ["Generate custom tour"]),
    ]);

    var prGenerate = el("div", { id: "ua-pr-generate" }, [
      el("h4", {}, ["Generate a PR walkthrough"]),
      el("p", {}, ["Enter a PR number, or a base branch to diff against HEAD (e.g. main)."]),
      el("input", { id: "ua-pr-input", type: "text", placeholder: "42 or main" }),
      el("button", { id: "ua-pr-generate-btn" }, ["Generate PR walkthrough"]),
    ]);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(generate);
    panel.appendChild(prGenerate);
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    var player = el("div", { id: "ua-tour-player" }, [
      el("div", { id: "ua-tour-player-controls" }),
    ]);
    player.insertBefore(el("h4", { id: "ua-tour-player-title" }, [""]), player.firstChild);
    player.insertBefore(el("p", { id: "ua-tour-player-desc" }, [""]), player.querySelector("#ua-tour-player-controls"));
    var controls = player.querySelector("#ua-tour-player-controls");
    var prevBtn = el("button", { id: "ua-tour-prev" }, ["◀ Prev"]);
    var stepCount = el("span", { id: "ua-tour-step-count" }, [""]);
    var nextBtn = el("button", { id: "ua-tour-next" }, ["Next ▶"]);
    var closeBtn = el("button", { id: "ua-tour-player-close" }, ["Close"]);
    controls.appendChild(prevBtn);
    controls.appendChild(stepCount);
    controls.appendChild(nextBtn);
    controls.appendChild(closeBtn);
    document.body.appendChild(player);

    fab.addEventListener("click", function () {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) renderTourList();
    });
    header.querySelector("#ua-tours-close").addEventListener("click", function () { panel.classList.remove("open"); });
    document.getElementById("ua-tour-generate-btn").addEventListener("click", generateTour);
    document.getElementById("ua-pr-generate-btn").addEventListener("click", generatePrTour);

    prevBtn.addEventListener("click", function () { if (currentStep > 0) { currentStep--; renderPlayerStep(); } });
    nextBtn.addEventListener("click", function () { if (currentTour && currentStep < currentTour.steps.length - 1) { currentStep++; renderPlayerStep(); } });
    closeBtn.addEventListener("click", closePlayer);

    if (window.uaSelection) {
      renderSelectionCount(window.uaSelection.get());
      window.uaSelection.subscribe(renderSelectionCount);
    } else {
      renderSelectionCount([]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
