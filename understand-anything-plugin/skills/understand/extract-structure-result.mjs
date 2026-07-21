// Pure result mapping for extract-structure.mjs.
// Kept separate from the CLI entrypoint so unit tests do not import a shebang script.
const REQUIRED_STRUCTURE_ARRAY_FIELDS = [
  'functions',
  'classes',
  'imports',
  'exports',
];
const OPTIONAL_STRUCTURE_ARRAY_FIELDS = [
  'sections',
  'definitions',
  'services',
  'endpoints',
  'steps',
  'resources',
];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isFiniteInteger(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value);
}

function isLineRange(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every(isFiniteInteger);
}

function hasValidOptionalField(value, field, validator) {
  return value[field] === undefined || validator(value[field]);
}

function isValidEntryArray(value, validator) {
  return Array.isArray(value) &&
    value.every(entry => isPlainObject(entry) && validator(entry));
}

const STRUCTURE_ENTRY_VALIDATORS = {
  functions: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.params) &&
    hasValidOptionalField(entry, 'returnType', value => typeof value === 'string'),
  classes: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.methods) &&
    isStringArray(entry.properties),
  imports: entry =>
    typeof entry.source === 'string' &&
    isStringArray(entry.specifiers) &&
    isFiniteInteger(entry.lineNumber),
  exports: entry =>
    typeof entry.name === 'string' &&
    isFiniteInteger(entry.lineNumber) &&
    hasValidOptionalField(entry, 'isDefault', value => typeof value === 'boolean'),
  sections: entry =>
    typeof entry.name === 'string' &&
    isFiniteInteger(entry.level) &&
    isLineRange(entry.lineRange),
  definitions: entry =>
    typeof entry.name === 'string' &&
    typeof entry.kind === 'string' &&
    isLineRange(entry.lineRange) &&
    isStringArray(entry.fields),
  services: entry =>
    typeof entry.name === 'string' &&
    hasValidOptionalField(entry, 'image', value => typeof value === 'string') &&
    Array.isArray(entry.ports) &&
    entry.ports.every(isFiniteInteger) &&
    hasValidOptionalField(entry, 'lineRange', isLineRange),
  endpoints: entry =>
    hasValidOptionalField(entry, 'method', value => typeof value === 'string') &&
    typeof entry.path === 'string' &&
    isLineRange(entry.lineRange),
  steps: entry =>
    typeof entry.name === 'string' &&
    isLineRange(entry.lineRange),
  resources: entry =>
    typeof entry.name === 'string' &&
    typeof entry.kind === 'string' &&
    isLineRange(entry.lineRange),
};

function isValidStructuralAnalysis(analysis) {
  if (!isPlainObject(analysis)) {
    return false;
  }

  return REQUIRED_STRUCTURE_ARRAY_FIELDS.every(field =>
    isValidEntryArray(analysis[field], STRUCTURE_ENTRY_VALIDATORS[field])) &&
    OPTIONAL_STRUCTURE_ARRAY_FIELDS.every(field =>
      hasValidOptionalField(
        analysis,
        field,
        value => isValidEntryArray(value, STRUCTURE_ENTRY_VALIDATORS[field]),
      ));
}

function isValidCallGraph(callGraph) {
  return Array.isArray(callGraph) && callGraph.every(entry =>
    isPlainObject(entry) &&
    typeof entry.caller === 'string' &&
    typeof entry.callee === 'string' &&
    isFiniteInteger(entry.lineNumber));
}

function mapCallGraph(callGraph) {
  return callGraph && callGraph.length > 0
    ? callGraph.map(entry => ({
        caller: entry.caller,
        callee: entry.callee,
        lineNumber: entry.lineNumber,
      }))
    : null;
}

export function analyzeFileWithOutcomes(registry, file, content) {
  const wantsCallGraph =
    file.fileCategory === 'code' || file.fileCategory === 'script';
  const selectedPlugin = typeof registry.getPluginForFile === 'function'
    ? registry.getPluginForFile(file.path)
    : registry;

  if (selectedPlugin === null) {
    return {
      analysis: null,
      callGraph: null,
      structureOutcome: 'skipped',
      callGraphOutcome: 'skipped',
    };
  }

  const supportsFullAnalysis =
    typeof selectedPlugin?.analyzeFileFull === 'function';
  const supportsSeparateCallGraph =
    typeof selectedPlugin?.extractCallGraph === 'function';

  if (wantsCallGraph && supportsFullAnalysis) {
    let full;
    try {
      full = registry.analyzeFileFull(file.path, content);
    } catch {
      return {
        analysis: null,
        callGraph: null,
        structureOutcome: 'failed',
        callGraphOutcome: wantsCallGraph ? 'failed' : 'skipped',
      };
    }

    const analysis = isValidStructuralAnalysis(full?.structure)
      ? full.structure
      : null;
    const hasValidCallGraph = wantsCallGraph && isValidCallGraph(full?.callGraph);
    const callGraph = hasValidCallGraph ? mapCallGraph(full.callGraph) : null;

    return {
      analysis,
      callGraph,
      structureOutcome: analysis === null ? 'failed' : 'succeeded',
      callGraphOutcome: wantsCallGraph
        ? hasValidCallGraph ? 'succeeded' : 'failed'
        : 'skipped',
    };
  }

  let analysis = null;
  let callGraph = null;
  let structureOutcome = 'failed';
  let callGraphOutcome = wantsCallGraph && supportsSeparateCallGraph
    ? 'failed'
    : 'skipped';

  try {
    const extractedAnalysis = registry.analyzeFile(file.path, content);
    if (isValidStructuralAnalysis(extractedAnalysis)) {
      analysis = extractedAnalysis;
      structureOutcome = 'succeeded';
    }
  } catch {
    analysis = null;
    structureOutcome = 'failed';
  }

  if (wantsCallGraph && supportsSeparateCallGraph) {
    try {
      const extractedCallGraph = registry.extractCallGraph(file.path, content);
      if (isValidCallGraph(extractedCallGraph)) {
        callGraph = mapCallGraph(extractedCallGraph);
        callGraphOutcome = 'succeeded';
      }
    } catch {
      callGraph = null;
      callGraphOutcome = 'failed';
    }
  }

  return { analysis, callGraph, structureOutcome, callGraphOutcome };
}

export function buildResult(file, totalLines, nonEmptyLines, analysis, callGraph, batchImportData) {
  const base = {
    path: file.path,
    language: file.language,
    fileCategory: file.fileCategory,
    totalLines,
    nonEmptyLines,
  };

  if (!analysis) {
    base.metrics = {};
    return base;
  }

  if (analysis.functions && analysis.functions.length > 0) {
    base.functions = analysis.functions.map(fn => ({
      name: fn.name,
      startLine: fn.lineRange[0],
      endLine: fn.lineRange[1],
      params: fn.params || [],
    }));
  }

  if (analysis.classes && analysis.classes.length > 0) {
    base.classes = analysis.classes.map(cls => ({
      name: cls.name,
      startLine: cls.lineRange[0],
      endLine: cls.lineRange[1],
      methods: cls.methods || [],
      properties: cls.properties || [],
    }));
  }

  if (analysis.imports?.length) {
    base.imports = analysis.imports.map(imp => {
      const aliasEntries = imp.aliases
        ? Object.entries(imp.aliases).filter(
            ([key, value]) => typeof key === "string" && typeof value === "string",
          )
        : [];
      return {
        source: imp.source,
        specifiers: Array.isArray(imp.specifiers) ? [...imp.specifiers] : [],
        ...(aliasEntries.length
          ? { aliases: Object.fromEntries(aliasEntries) }
          : {}),
        lineNumber: imp.lineNumber,
      };
    });
  }

  if (analysis.exports && analysis.exports.length > 0) {
    base.exports = analysis.exports.map(exp => ({
      name: exp.name,
      line: exp.lineNumber,
      isDefault: exp.isDefault === true,
    }));
  }

  if (analysis.sections && analysis.sections.length > 0) {
    base.sections = analysis.sections.map(s => ({
      heading: s.name,
      level: s.level,
      line: s.lineRange[0],
    }));
  }

  if (analysis.definitions && analysis.definitions.length > 0) {
    base.definitions = analysis.definitions.map(d => ({
      name: d.name,
      kind: d.kind,
      fields: d.fields || [],
      startLine: d.lineRange[0],
      endLine: d.lineRange[1],
    }));
  }

  if (analysis.services && analysis.services.length > 0) {
    base.services = analysis.services.map(s => ({
      name: s.name,
      image: s.image,
      ports: s.ports || [],
      ...(s.lineRange ? { startLine: s.lineRange[0], endLine: s.lineRange[1] } : {}),
    }));
  }

  if (analysis.endpoints && analysis.endpoints.length > 0) {
    base.endpoints = analysis.endpoints.map(e => ({
      method: e.method,
      path: e.path,
      startLine: e.lineRange[0],
      endLine: e.lineRange[1],
    }));
  }

  if (analysis.steps && analysis.steps.length > 0) {
    base.steps = analysis.steps.map(s => ({
      name: s.name,
      startLine: s.lineRange[0],
      endLine: s.lineRange[1],
    }));
  }

  if (analysis.resources && analysis.resources.length > 0) {
    base.resources = analysis.resources.map(r => ({
      name: r.name,
      kind: r.kind,
      startLine: r.lineRange[0],
      endLine: r.lineRange[1],
    }));
  }

  if (callGraph && callGraph.length > 0) {
    base.callGraph = callGraph;
  }

  const metrics = {};

  const importPaths = batchImportData?.[file.path];
  if (importPaths && importPaths.length > 0) {
    metrics.importCount = importPaths.length;
  } else if (analysis.imports) {
    const internal = analysis.imports.filter(imp => {
      const src = imp?.source ?? '';
      return src.startsWith('.');
    });
    metrics.importCount = internal.length;
  }

  if (analysis.exports) {
    metrics.exportCount = analysis.exports.length;
  }
  if (analysis.functions) {
    metrics.functionCount = analysis.functions.length;
  }
  if (analysis.classes) {
    metrics.classCount = analysis.classes.length;
  }
  if (analysis.sections) {
    metrics.sectionCount = analysis.sections.length;
  }
  if (analysis.definitions) {
    metrics.definitionCount = analysis.definitions.length;
  }
  if (analysis.services) {
    metrics.serviceCount = analysis.services.length;
  }
  if (analysis.endpoints) {
    metrics.endpointCount = analysis.endpoints.length;
  }
  if (analysis.steps) {
    metrics.stepCount = analysis.steps.length;
  }
  if (analysis.resources) {
    metrics.resourceCount = analysis.resources.length;
  }

  base.metrics = metrics;

  return base;
}
