export { parseFileKey, FigmaApiSource } from "./source/api-source.js";
export type { FigmaSource, FigmaDocument, FigmaStyles, FigmaNode } from "./source/types.js";
export { parseDocument } from "./parse/parse-document.js";
export { extractTokens } from "./parse/tokens.js";
export { applyScreenThumbnails } from "./thumbnails.js";
export { mergeDesignGraph, type DesignAnalysis } from "./merge.js";
