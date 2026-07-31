import { describe, expect, it } from 'vitest';

import * as extractStructure from '../../../understand-anything-plugin/skills/understand/extract-structure-result.mjs';

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

function validAnalysis() {
  return {
    functions: [],
    classes: [],
    imports: [],
    exports: [],
  };
}

function validCallGraph() {
  return [{ caller: 'entry', callee: 'target', lineNumber: 1 }];
}

const VALID_STRUCTURE_ENTRIES = {
  functions: {
    name: 'run',
    lineRange: [1, 2],
    params: ['value'],
    returnType: 'string',
  },
  classes: {
    name: 'Runner',
    lineRange: [1, 3],
    methods: ['run'],
    properties: ['value'],
  },
  imports: {
    source: './dependency.js',
    specifiers: ['dependency'],
    lineNumber: 1,
  },
  exports: {
    name: 'run',
    lineNumber: 2,
    isDefault: false,
  },
  sections: {
    name: 'Overview',
    level: 1,
    lineRange: [1, 2],
  },
  definitions: {
    name: 'users',
    kind: 'table',
    lineRange: [1, 2],
    fields: ['id'],
  },
  services: {
    name: 'api',
    image: 'example/api',
    ports: [8080],
    lineRange: [1, 2],
  },
  endpoints: {
    method: 'GET',
    path: '/health',
    lineRange: [1, 2],
  },
  steps: {
    name: 'build',
    lineRange: [1, 2],
  },
  resources: {
    name: 'bucket',
    kind: 'storage',
    lineRange: [1, 2],
  },
};

const MALFORMED_STRUCTURE_ENTRIES = [
  ['a null function entry', 'functions', null],
  ['an array function entry', 'functions', []],
  ['a function with a non-string name', 'functions', {
    ...VALID_STRUCTURE_ENTRIES.functions,
    name: 1,
  }],
  ['a function with a non-pair line range', 'functions', {
    ...VALID_STRUCTURE_ENTRIES.functions,
    lineRange: [1],
  }],
  ['a function with non-string params', 'functions', {
    ...VALID_STRUCTURE_ENTRIES.functions,
    params: ['value', 2],
  }],
  ['a function with a non-string return type', 'functions', {
    ...VALID_STRUCTURE_ENTRIES.functions,
    returnType: false,
  }],
  ['a class with a non-string name', 'classes', {
    ...VALID_STRUCTURE_ENTRIES.classes,
    name: false,
  }],
  ['a class with an overlong line range', 'classes', {
    ...VALID_STRUCTURE_ENTRIES.classes,
    lineRange: [1, 2, 3],
  }],
  ['a class with a non-array methods field', 'classes', {
    ...VALID_STRUCTURE_ENTRIES.classes,
    methods: 'run',
  }],
  ['a class with non-string properties', 'classes', {
    ...VALID_STRUCTURE_ENTRIES.classes,
    properties: ['value', null],
  }],
  ['an import with a non-string source', 'imports', {
    ...VALID_STRUCTURE_ENTRIES.imports,
    source: null,
  }],
  ['an import with non-string specifiers', 'imports', {
    ...VALID_STRUCTURE_ENTRIES.imports,
    specifiers: ['dependency', 1],
  }],
  ['an import with a non-number line', 'imports', {
    ...VALID_STRUCTURE_ENTRIES.imports,
    lineNumber: '1',
  }],
  ['an export with a non-string name', 'exports', {
    ...VALID_STRUCTURE_ENTRIES.exports,
    name: {},
  }],
  ['an export with a fractional line', 'exports', {
    ...VALID_STRUCTURE_ENTRIES.exports,
    lineNumber: 1.5,
  }],
  ['an export with a non-boolean default flag', 'exports', {
    ...VALID_STRUCTURE_ENTRIES.exports,
    isDefault: 'false',
  }],
  ['a section with a non-string name', 'sections', {
    ...VALID_STRUCTURE_ENTRIES.sections,
    name: 0,
  }],
  ['a section with an infinite level', 'sections', {
    ...VALID_STRUCTURE_ENTRIES.sections,
    level: Infinity,
  }],
  ['a section with a fractional line range', 'sections', {
    ...VALID_STRUCTURE_ENTRIES.sections,
    lineRange: [1, 2.5],
  }],
  ['a definition with a non-string name', 'definitions', {
    ...VALID_STRUCTURE_ENTRIES.definitions,
    name: undefined,
  }],
  ['a definition with a non-string kind', 'definitions', {
    ...VALID_STRUCTURE_ENTRIES.definitions,
    kind: 1,
  }],
  ['a definition with a non-finite line range', 'definitions', {
    ...VALID_STRUCTURE_ENTRIES.definitions,
    lineRange: [1, Infinity],
  }],
  ['a definition with a non-array fields field', 'definitions', {
    ...VALID_STRUCTURE_ENTRIES.definitions,
    fields: 'id',
  }],
  ['a service with a non-string name', 'services', {
    ...VALID_STRUCTURE_ENTRIES.services,
    name: false,
  }],
  ['a service with a non-string image', 'services', {
    ...VALID_STRUCTURE_ENTRIES.services,
    image: 7,
  }],
  ['a service with fractional ports', 'services', {
    ...VALID_STRUCTURE_ENTRIES.services,
    ports: [80.5],
  }],
  ['a service with a non-array optional line range', 'services', {
    ...VALID_STRUCTURE_ENTRIES.services,
    lineRange: '1-2',
  }],
  ['an endpoint with a non-string method', 'endpoints', {
    ...VALID_STRUCTURE_ENTRIES.endpoints,
    method: 7,
  }],
  ['an endpoint with a non-string path', 'endpoints', {
    ...VALID_STRUCTURE_ENTRIES.endpoints,
    path: null,
  }],
  ['an endpoint with a non-number line range', 'endpoints', {
    ...VALID_STRUCTURE_ENTRIES.endpoints,
    lineRange: [1, '2'],
  }],
  ['a step with a non-string name', 'steps', {
    ...VALID_STRUCTURE_ENTRIES.steps,
    name: [],
  }],
  ['a step with a NaN line range', 'steps', {
    ...VALID_STRUCTURE_ENTRIES.steps,
    lineRange: [1, NaN],
  }],
  ['a resource with a non-string name', 'resources', {
    ...VALID_STRUCTURE_ENTRIES.resources,
    name: 1,
  }],
  ['a resource with a non-string kind', 'resources', {
    ...VALID_STRUCTURE_ENTRIES.resources,
    kind: null,
  }],
  ['a resource with a null line range', 'resources', {
    ...VALID_STRUCTURE_ENTRIES.resources,
    lineRange: null,
  }],
];

const VALID_BOUNDARY_ANALYSES = [
  ['required collections with optional fields and arrays absent', {
    functions: [{
      name: 'run',
      lineRange: [-1, 0],
      params: [],
      extraFunctionProperty: true,
    }],
    classes: [{
      name: 'Runner',
      lineRange: [-2, 0],
      methods: [],
      properties: [],
      extraClassProperty: true,
    }],
    imports: [{
      source: './dependency.js',
      specifiers: [],
      lineNumber: 0,
      extraImportProperty: true,
    }],
    exports: [{
      name: 'run',
      lineNumber: -1,
      extraExportProperty: true,
    }],
    extraAnalysisProperty: true,
  }],
  ['optional collections with nested optional fields absent', {
    ...validAnalysis(),
    sections: [{
      name: 'Overview',
      level: 0,
      lineRange: [-1, 0],
      extraSectionProperty: true,
    }],
    definitions: [{
      name: 'users',
      kind: 'table',
      lineRange: [-1, 0],
      fields: [],
      extraDefinitionProperty: true,
    }],
    services: [{
      name: 'api',
      ports: [0, -1],
      extraServiceProperty: true,
    }],
    endpoints: [{
      path: '/health',
      lineRange: [-1, 0],
      extraEndpointProperty: true,
    }],
    steps: [{
      name: 'build',
      lineRange: [-1, 0],
      extraStepProperty: true,
    }],
    resources: [{
      name: 'bucket',
      kind: 'storage',
      lineRange: [-1, 0],
      extraResourceProperty: true,
    }],
    extraAnalysisProperty: true,
  }],
];

function analysisWithEntry(collection, entry) {
  return {
    ...validAnalysis(),
    [collection]: [entry],
  };
}

function analyzeStructuralOutput(mode, analysis) {
  const parser = mode === 'full'
    ? {
        analyzeFileFull() {
          return { structure: analysis, callGraph: validCallGraph() };
        },
      }
    : {
        analyzeFile() {
          return analysis;
        },
      };
  const registry = {
    getPluginForFile() {
      return parser;
    },
    analyzeFileFull(path, content) {
      return parser.analyzeFileFull(path, content);
    },
    analyzeFile(path, content) {
      return parser.analyzeFile(path, content);
    },
  };

  return extractStructure.analyzeFileWithOutcomes(
    registry,
    { path: `src/${mode}-structure.ts`, fileCategory: 'code' },
    'export const value = 1;\n',
  );
}

describe('extract-structure analysis outcomes', () => {
  it('skips structure and call-graph analysis when no parser supports the file', () => {
    const registry = {
      getPluginForFile() {
        return null;
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/unsupported.xyz', fileCategory: 'code' },
        'unsupported content\n',
      ),
    ).toEqual({
      analysis: null,
      callGraph: null,
      structureOutcome: 'skipped',
      callGraphOutcome: 'skipped',
    });
  });

  it('skips call-graph analysis when the selected parser only supports structure', () => {
    const analysis = validAnalysis();
    const parser = {
      analyzeFile() {
        return analysis;
      },
    };
    const registry = {
      getPluginForFile() {
        return parser;
      },
      analyzeFile(path, content) {
        return parser.analyzeFile(path, content);
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/structure-only.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toEqual({
      analysis,
      callGraph: null,
      structureOutcome: 'succeeded',
      callGraphOutcome: 'skipped',
    });
  });

  it('uses separate structure analysis for non-code files even when full analysis is advertised', () => {
    const analysis = validAnalysis();
    let fullCalls = 0;
    let separateCalls = 0;
    const parser = {
      analyzeFileFull() {
        fullCalls += 1;
        throw new Error('full analysis must not run for non-code files');
      },
      analyzeFile() {
        separateCalls += 1;
        return analysis;
      },
    };
    const registry = {
      getPluginForFile() {
        return parser;
      },
      analyzeFileFull(path, content) {
        return parser.analyzeFileFull(path, content);
      },
      analyzeFile(path, content) {
        return parser.analyzeFile(path, content);
      },
    };

    const result = extractStructure.analyzeFileWithOutcomes(
      registry,
      { path: 'README.md', fileCategory: 'docs' },
      '# Documentation\n',
    );

    expect({ result, fullCalls, separateCalls }).toEqual({
      result: {
        analysis,
        callGraph: null,
        structureOutcome: 'succeeded',
        callGraphOutcome: 'skipped',
      },
      fullCalls: 0,
      separateCalls: 1,
    });
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('combined parser failed');
      },
    ],
    ['returns null', () => null],
    ['returns undefined', () => undefined],
  ])(
    'does not hide advertised full analysis that %s behind successful separate calls',
    (_behavior, analyzeFileFull) => {
      const fallbackAnalysis = validAnalysis();
      const fallbackCallGraph = validCallGraph();
      const parser = {
        analyzeFileFull,
        analyzeFile() {
          return fallbackAnalysis;
        },
        extractCallGraph() {
          return fallbackCallGraph;
        },
      };
      const registry = {
        getPluginForFile() {
          return parser;
        },
        analyzeFileFull(path, content) {
          return parser.analyzeFileFull(path, content);
        },
        analyzeFile(path, content) {
          return parser.analyzeFile(path, content);
        },
        extractCallGraph(path, content) {
          return parser.extractCallGraph(path, content);
        },
      };

      expect(
        extractStructure.analyzeFileWithOutcomes(
          registry,
          { path: 'src/full-failing.ts', fileCategory: 'code' },
          'export const value = 1;\n',
        ),
      ).toEqual({
        analysis: null,
        callGraph: null,
        structureOutcome: 'failed',
        callGraphOutcome: 'failed',
      });
    },
  );

  it('validates structure independently in a full-analysis result', () => {
    const callGraph = validCallGraph();
    const parser = {
      analyzeFileFull() {
        return { structure: {}, callGraph };
      },
    };
    const registry = {
      getPluginForFile() {
        return parser;
      },
      analyzeFileFull(path, content) {
        return parser.analyzeFileFull(path, content);
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/full-structure-invalid.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toEqual({
      analysis: null,
      callGraph,
      structureOutcome: 'failed',
      callGraphOutcome: 'succeeded',
    });
  });

  it('validates call-graph entries independently in a full-analysis result', () => {
    const analysis = validAnalysis();
    const parser = {
      analyzeFileFull() {
        return {
          structure: analysis,
          callGraph: [{ caller: 'entry', callee: 'target', lineNumber: 1.5 }],
        };
      },
    };
    const registry = {
      getPluginForFile() {
        return parser;
      },
      analyzeFileFull(path, content) {
        return parser.analyzeFileFull(path, content);
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/full-call-graph-invalid.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toEqual({
      analysis,
      callGraph: null,
      structureOutcome: 'succeeded',
      callGraphOutcome: 'failed',
    });
  });

  it.each([
    ['a number', 42],
    ['an array', []],
    ['an object without required arrays', {}],
    ...REQUIRED_STRUCTURE_ARRAY_FIELDS.map(field => [
      `a non-array ${field} field`,
      { ...validAnalysis(), [field]: null },
    ]),
    ...OPTIONAL_STRUCTURE_ARRAY_FIELDS.map(field => [
      `a non-array optional ${field} field`,
      { ...validAnalysis(), [field]: {} },
    ]),
  ])('rejects separate structural output containing %s', (_description, malformed) => {
    const parser = {
      analyzeFile() {
        return malformed;
      },
    };
    const registry = {
      getPluginForFile() {
        return parser;
      },
      analyzeFile(path, content) {
        return parser.analyzeFile(path, content);
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/malformed-structure.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toEqual({
      analysis: null,
      callGraph: null,
      structureOutcome: 'failed',
      callGraphOutcome: 'skipped',
    });
  });

  it.each(MALFORMED_STRUCTURE_ENTRIES)(
    'rejects %s through separate and full structural analysis',
    (_description, collection, malformedEntry) => {
      const malformed = analysisWithEntry(collection, malformedEntry);
      const callGraph = validCallGraph();
      const results = {
        separate: analyzeStructuralOutput('separate', malformed),
        full: analyzeStructuralOutput('full', malformed),
      };

      expect(results).toEqual({
        separate: {
          analysis: null,
          callGraph: null,
          structureOutcome: 'failed',
          callGraphOutcome: 'skipped',
        },
        full: {
          analysis: null,
          callGraph,
          structureOutcome: 'failed',
          callGraphOutcome: 'succeeded',
        },
      });
    },
  );

  it.each(VALID_BOUNDARY_ANALYSES)(
    'accepts %s through separate and full structural analysis',
    (_description, analysis) => {
      const callGraph = validCallGraph();

      expect({
        separate: analyzeStructuralOutput('separate', analysis),
        full: analyzeStructuralOutput('full', analysis),
      }).toEqual({
        separate: {
          analysis,
          callGraph: null,
          structureOutcome: 'succeeded',
          callGraphOutcome: 'skipped',
        },
        full: {
          analysis,
          callGraph,
          structureOutcome: 'succeeded',
          callGraphOutcome: 'succeeded',
        },
      });
    },
  );

  it.each([
    ['a non-string caller', { caller: 1, callee: 'target', lineNumber: 1 }],
    ['a non-string callee', { caller: 'entry', callee: null, lineNumber: 1 }],
    ['a non-number line', { caller: 'entry', callee: 'target', lineNumber: '1' }],
    ['an infinite line', { caller: 'entry', callee: 'target', lineNumber: Infinity }],
    ['a NaN line', { caller: 'entry', callee: 'target', lineNumber: NaN }],
    ['a fractional line', { caller: 'entry', callee: 'target', lineNumber: 1.5 }],
  ])('rejects a separate call graph containing %s', (_description, malformedEntry) => {
    const analysis = validAnalysis();
    const parser = {
      analyzeFile() {
        return analysis;
      },
      extractCallGraph() {
        return [malformedEntry];
      },
    };
    const registry = {
      getPluginForFile() {
        return parser;
      },
      analyzeFile(path, content) {
        return parser.analyzeFile(path, content);
      },
      extractCallGraph(path, content) {
        return parser.extractCallGraph(path, content);
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/malformed-call-graph.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toEqual({
      analysis,
      callGraph: null,
      structureOutcome: 'succeeded',
      callGraphOutcome: 'failed',
    });
  });

  it('records advertised full-analysis exceptions as failures', () => {
    expect(extractStructure.analyzeFileWithOutcomes).toBeTypeOf('function');
    const registry = {
      analyzeFileFull() {
        throw new Error('combined parser failed');
      },
      analyzeFile() {
        throw new Error('structure parser failed');
      },
      extractCallGraph() {
        throw new Error('call graph failed');
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/failing.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toEqual({
      analysis: null,
      callGraph: null,
      structureOutcome: 'failed',
      callGraphOutcome: 'failed',
    });
  });

  it('does not count missing parser return values as successful analysis', () => {
    const registry = {
      analyzeFileFull() {
        return undefined;
      },
      analyzeFile() {
        return undefined;
      },
      extractCallGraph() {
        return undefined;
      },
    };

    expect(
      extractStructure.analyzeFileWithOutcomes(
        registry,
        { path: 'src/missing.ts', fileCategory: 'code' },
        'export const value = 1;\n',
      ),
    ).toMatchObject({
      structureOutcome: 'failed',
      callGraphOutcome: 'failed',
    });
  });
});
