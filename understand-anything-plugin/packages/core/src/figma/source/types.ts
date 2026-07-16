export interface FigmaNode {
  id: string;
  name: string;
  type: string; // DOCUMENT | CANVAS | FRAME | SECTION | COMPONENT | COMPONENT_SET | INSTANCE | TEXT | ...
  children?: FigmaNode[];
  componentId?: string;        // on INSTANCE → main component node id
  absoluteBoundingBox?: { width: number; height: number } | null;
  styles?: Record<string, string>; // styleType (fill/text/effect/grid) → file-local style id, resolved via FigmaDocument.styles
  transitionNodeID?: string | null; // prototype target node id
}

export interface FigmaDocument {
  name: string;
  document: FigmaNode; // root (DOCUMENT) whose children are CANVAS (pages)
  components?: Record<string, { key: string; name: string; componentSetId?: string }>;
  componentSets?: Record<string, { key: string; name: string }>;
  styles?: Record<string, { key: string; name?: string; styleType?: string }>; // file-local style id → published style; bridges node.styles to /files/:key/styles keys
  version?: string;       // Figma file version (changes on every edit)
  lastModified?: string;  // ISO timestamp
}

export interface FigmaStyles {
  meta?: { styles?: Array<{ key: string; name: string; style_type: string }> };
}

export interface FigmaSource {
  fetchDocument(): Promise<FigmaDocument>;
  fetchStyles(): Promise<FigmaStyles>;
  renderImages(nodeIds: string[]): Promise<Record<string, string>>;
}
