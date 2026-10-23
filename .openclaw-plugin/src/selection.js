// Shared node-selection discovery — the single source of truth for "what
// node(s) is the user currently looking at in the graph canvas", read by both
// ask-widget.js and tours-widget.js (previously each widget that cared kept
// its own private MutationObserver; now there's exactly one, watching once).
//
// Must be loaded before ask-widget.js/tours-widget.js — see WIDGET_SCRIPT_TAGS
// in interactive-server.ts.
(function () {
  "use strict";

  var selectedNodeIds = [];
  var subscribers = [];

  function sameIds(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function refresh() {
    var nodes = document.querySelectorAll(".react-flow__node.selected");
    var next = Array.prototype.map.call(nodes, function (n) { return n.getAttribute("data-id"); }).filter(Boolean);
    if (sameIds(next, selectedNodeIds)) return;
    selectedNodeIds = next;
    subscribers.forEach(function (cb) { cb(selectedNodeIds.slice()); });
  }

  window.uaSelection = {
    // Current selection snapshot — a plain array of graph node ids.
    get: function () { return selectedNodeIds.slice(); },
    // Called with the new selection (array of ids) whenever it changes.
    // Returns an unsubscribe function.
    subscribe: function (cb) {
      subscribers.push(cb);
      return function () { subscribers = subscribers.filter(function (s) { return s !== cb; }); };
    },
  };

  function start() {
    // React Flow toggles the "selected" class on node elements; watching for
    // class-attribute changes across the document catches every selection
    // change without touching the dashboard's own React source.
    var observer = new MutationObserver(refresh);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
