// Floating "Ask" chat widget — injected into the dashboard by
// interactive-server.ts. Talks to POST /ask.json using the same access token
// the page itself was loaded with (?token= in the URL). Vanilla JS/CSS, no
// build step, so it stays independent of the dashboard's own React app and
// its build pipeline.
//
// Grounds each question in whatever node(s) are currently selected in the
// graph canvas, via the shared discovery in selection.js (window.uaSelection)
// — the same mechanism the Tours widget uses for custom-tour scoping.
(function () {
  "use strict";

  var TOKEN = new URLSearchParams(window.location.search).get("token") || "";

  var STYLE = "\n" +
    "#ua-ask-fab{position:fixed;bottom:24px;right:24px;z-index:9999;width:56px;height:56px;border-radius:50%;" +
    "background:#1f6feb;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;" +
    "font-size:24px;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;}\n" +
    "#ua-ask-fab:hover{background:#3b82f6;}\n" +
    "#ua-ask-panel{position:fixed;bottom:92px;right:24px;z-index:9999;width:380px;max-width:calc(100vw - 48px);" +
    "height:520px;max-height:calc(100vh - 140px);background:#0d1117;color:#e6edf3;border:1px solid #30363d;" +
    "border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);display:none;flex-direction:column;" +
    "font-family:system-ui,-apple-system,sans-serif;overflow:hidden;}\n" +
    "#ua-ask-panel.open{display:flex;}\n" +
    "#ua-ask-header{padding:12px 14px;border-bottom:1px solid #30363d;font-weight:600;font-size:14px;" +
    "display:flex;justify-content:space-between;align-items:center;}\n" +
    "#ua-ask-header button{background:none;border:none;color:#8b949e;cursor:pointer;font-size:18px;}\n" +
    "#ua-ask-messages{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}\n" +
    ".ua-ask-msg{font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;}\n" +
    ".ua-ask-msg.user{align-self:flex-end;background:#1f6feb;color:#fff;padding:8px 12px;border-radius:12px 12px 2px 12px;max-width:85%;}\n" +
    ".ua-ask-msg.assistant{align-self:flex-start;background:#161b22;padding:8px 12px;border-radius:12px 12px 12px 2px;max-width:90%;border:1px solid #30363d;}\n" +
    ".ua-ask-msg.error{align-self:flex-start;color:#f85149;font-style:italic;}\n" +
    ".ua-ask-cites{margin-top:6px;font-size:11px;color:#8b949e;}\n" +
    ".ua-ask-cites code{background:#21262d;padding:1px 4px;border-radius:4px;}\n" +
    "#ua-ask-form{border-top:1px solid #30363d;padding:10px;display:flex;gap:8px;}\n" +
    "#ua-ask-input{flex:1;background:#161b22;border:1px solid #30363d;border-radius:8px;color:#e6edf3;" +
    "padding:8px 10px;font-size:13px;resize:none;font-family:inherit;}\n" +
    "#ua-ask-send{background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer;font-size:13px;}\n" +
    "#ua-ask-send:disabled{opacity:.5;cursor:default;}\n" +
    "#ua-ask-empty{color:#8b949e;font-size:13px;padding:8px 0;}\n" +
    "#ua-ask-selection{font-size:11px;color:#8b949e;padding:6px 14px;border-top:1px solid #30363d;}\n" +
    "#ua-ask-selection code{background:#21262d;padding:1px 4px;border-radius:4px;}\n";

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) {
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function addMessage(container, role, text, citedNodes) {
    var msg = el("div", { class: "ua-ask-msg " + role });
    msg.textContent = text;
    if (citedNodes && citedNodes.length) {
      var cites = el("div", { class: "ua-ask-cites" });
      cites.textContent = "Referenced: ";
      citedNodes.slice(0, 6).forEach(function (n, i) {
        if (i > 0) cites.appendChild(document.createTextNode(", "));
        cites.appendChild(el("code", {}, [n.filePath || n.name]));
      });
      msg.appendChild(cites);
    }
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return msg;
  }

  function init() {
    if (!TOKEN) return; // no token in URL — not a live session, don't offer Ask

    var style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    var fab = el("button", { id: "ua-ask-fab", title: "Ask about this codebase" }, ["💬"]);
    var panel = el("div", { id: "ua-ask-panel" });
    var header = el("div", { id: "ua-ask-header" }, [
      "Ask about this codebase",
      el("button", { id: "ua-ask-close" }, ["×"]),
    ]);
    var messages = el("div", { id: "ua-ask-messages" }, [
      el("div", { id: "ua-ask-empty" }, ["Ask a question about how this codebase works — grounded in the analyzed knowledge graph."]),
    ]);
    var selectionBar = el("div", { id: "ua-ask-selection" }, ["Nothing selected in the graph — asking generally."]);
    var input = el("textarea", { id: "ua-ask-input", rows: "1", placeholder: "e.g. how does the request flow work?" });
    var sendBtn = el("button", { id: "ua-ask-send" }, ["Ask"]);
    var form = el("div", { id: "ua-ask-form" }, [input, sendBtn]);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(selectionBar);
    panel.appendChild(form);
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.addEventListener("click", function () {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) input.focus();
    });
    header.querySelector("#ua-ask-close").addEventListener("click", function () {
      panel.classList.remove("open");
    });

    function renderSelectionBar(ids) {
      selectionBar.textContent = "";
      if (!ids.length) {
        selectionBar.textContent = "Nothing selected in the graph — asking generally.";
        return;
      }
      selectionBar.appendChild(document.createTextNode("Grounded in: "));
      ids.slice(0, 4).forEach(function (id, i) {
        if (i > 0) selectionBar.appendChild(document.createTextNode(", "));
        selectionBar.appendChild(el("code", {}, [id]));
      });
      if (ids.length > 4) selectionBar.appendChild(document.createTextNode(" +" + (ids.length - 4) + " more"));
    }

    if (window.uaSelection) {
      renderSelectionBar(window.uaSelection.get());
      window.uaSelection.subscribe(renderSelectionBar);
    }

    var asking = false;
    function ask() {
      var question = input.value.trim();
      if (!question || asking) return;
      var empty = document.getElementById("ua-ask-empty");
      if (empty) empty.remove();
      addMessage(messages, "user", question);
      input.value = "";
      asking = true;
      sendBtn.disabled = true;
      var thinking = addMessage(messages, "assistant", "Thinking…");

      fetch("/ask.json", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ask-Token": TOKEN },
        body: JSON.stringify({
          question: question,
          selectedNodeIds: window.uaSelection ? window.uaSelection.get() : [],
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || "Request failed");
            return data;
          });
        })
        .then(function (data) {
          thinking.remove();
          addMessage(messages, "assistant", data.answer, data.citedNodes);
        })
        .catch(function (err) {
          thinking.remove();
          addMessage(messages, "error", "Error: " + err.message);
        })
        .finally(function () {
          asking = false;
          sendBtn.disabled = false;
        });
    }

    sendBtn.addEventListener("click", ask);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ask();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
