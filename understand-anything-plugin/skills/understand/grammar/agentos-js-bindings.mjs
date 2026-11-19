/** Extract the AgentOS file-use patterns from syntax, without loading project modules. */
export const relativeModuleSpecifier = /^\.\.?\/[A-Za-z0-9._/-]+\.mjs$/;

const field = (node, name) => node?.childForFieldName(name);
const named = node => node?.namedChildren.filter(child => child.type !== 'comment') ?? [];
const identifier = node => node?.type === 'identifier' ? node.text : null;
const line = node => node.startPosition.row + 1;
const literal = node => node?.type === 'string' && !node.text.includes('\\') ? node.text.slice(1, -1) : null;
const callee = node => node?.type === 'call_expression' ? identifier(field(node, 'function')) : null;
const args = node => node?.type === 'call_expression' ? named(field(node, 'arguments')) : [];
const constVariables = node => node?.type === 'lexical_declaration' && field(node, 'kind')?.type === 'const' ? named(node) : [];

function bindingNames(node) {
  switch (node?.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      return [node];
    case 'assignment_pattern':
    case 'object_assignment_pattern':
      return bindingNames(field(node, 'left'));
    case 'pair_pattern':
      return bindingNames(field(node, 'value'));
    case 'formal_parameters':
    case 'object_pattern':
    case 'array_pattern':
    case 'rest_pattern':
    case 'parenthesized_expression':
      return named(node).flatMap(bindingNames);
    default:
      return [];
  }
}

const declarationFields = {
  variable_declarator: 'name', function_declaration: 'name', function_expression: 'name',
  generator_function_declaration: 'name', generator_function: 'name', class_declaration: 'name',
  class: 'name', arrow_function: 'parameter', catch_clause: 'parameter', for_in_statement: 'left',
};

function moduleBindings(program) {
  // Reject shadowed names anywhere in the module. These rules need no general
  // JavaScript scope resolution and can withhold when a binding is ambiguous.
  const definitions = new Map();
  const add = node => {
    for (const name of bindingNames(node)) {
      const sites = definitions.get(name.text) ?? new Set();
      sites.add(name.startIndex);
      definitions.set(name.text, sites);
    }
  };
  for (const node of program.descendantsOfType([...Object.keys(declarationFields), 'formal_parameters'])) {
    add(node.type === 'formal_parameters' ? node : field(node, declarationFields[node.type]));
  }
  const imports = [];
  const exports = [];
  const constants = [];
  for (const statement of named(program)) {
    for (const entry of constVariables(statement)) {
      const name = identifier(field(entry, 'name'));
      if (name) constants.push([name, entry]);
    }
    if (statement.type === 'import_statement') {
      const source = literal(field(statement, 'source'));
      const clause = named(statement).find(node => node.type === 'import_clause');
      for (const node of named(clause)) {
        if (node.type === 'named_imports') {
          for (const specifier of named(node)) {
            const local = field(specifier, 'alias') ?? field(specifier, 'name');
            add(local);
            if (source && identifier(local)) imports.push([local.text, { source, name: field(specifier, 'name')?.text }]);
          }
        } else {
          add(node.type === 'namespace_import' ? named(node)[0] : node);
        }
      }
    }
    if (statement.type === 'export_statement' && !statement.children.some(node => node.type === 'default')) {
      const declaration = field(statement, 'declaration');
      const entries = declaration?.type === 'function_declaration' ? [declaration] : constVariables(declaration);
      for (const entry of entries) {
        const name = identifier(field(entry, 'name'));
        if (name) exports.push([name, entry]);
      }
    }
  }
  const unshadowed = entries => new Map(entries.filter(([name]) => definitions.get(name)?.size === 1));
  return { imports: unshadowed(imports), exports: unshadowed(exports), constants: unshadowed(constants), definitions };
}

function callsImport(node, imports, source, name) {
  const binding = imports.get(callee(node));
  return binding?.source === source && binding.name === name;
}

function moduleRoot(entry, imports) {
  const resolve = field(entry, 'value');
  const [dirname, parent] = args(resolve);
  const [fromUrl] = args(dirname);
  const [url] = args(fromUrl);
  if (callsImport(resolve, imports, 'node:path', 'resolve') && args(resolve).length === 2 &&
      literal(parent) === '..' && callsImport(dirname, imports, 'node:path', 'dirname') && args(dirname).length === 1 &&
      callsImport(fromUrl, imports, 'node:url', 'fileURLToPath') && args(fromUrl).length === 1 &&
      url?.type === 'member_expression' && field(url, 'object')?.text === 'import.meta' &&
      field(url, 'property')?.text === 'url') {
    return { line: line(entry) };
  }
  return null;
}

function arrayElements(node) {
  if (node?.type !== 'array') return [];
  const elements = node.children.slice(1, -1).filter(child => child.type !== 'comment');
  // A sparse slot before the script would change its position in the child argv.
  return elements.every((child, index) => index % 2 ? child.type === ',' : child.isNamed)
    ? elements.filter((_child, index) => index % 2 === 0) : [];
}

function mentionsIdentifier(node, name) {
  return identifier(node) === name || node.descendantsOfType('identifier').some(child => child.text === name);
}

function pythonRunner(program, { imports, exports }) {
  const runner = exports.get('boundedProcess');
  const interpreter = exports.get('python');
  if (runner?.type !== 'function_declaration') return null;
  const writes = program.descendantsOfType(['assignment_expression', 'augmented_assignment_expression', 'update_expression']);
  if (writes.some(node => bindingNames(field(node, 'left') ?? field(node, 'argument'))
    .some(name => name.text === 'boundedProcess'))) return null;

  const selector = field(interpreter, 'value');
  const executable = field(selector, 'body');
  const [runtime, binary] = args(executable);
  if (selector?.type !== 'arrow_function' || named(field(selector, 'parameters')).length !== 0 ||
      !callsImport(executable, imports, 'node:path', 'resolve') || args(executable).length !== 2 ||
      callee(runtime) !== 'runtimeRoot' || args(runtime).length !== 0 ||
      !/^python\/bin\/python3(?:\.\d+)?$/.test(literal(binary))) return null;

  // The runner selects two routes, then spawns. Verify that each route forwards
  // the first parameter after the Python options, with no intervening statements.
  const [firstParameter, ...otherParameters] = named(field(runner, 'parameters'));
  const scriptArgs = identifier(firstParameter);
  const [select, launch] = named(field(runner, 'body'));
  const [state, command, parameters] = constVariables(select);
  const launchVariables = constVariables(launch);
  const spawn = field(launchVariables[0], 'value');
  const [programArg, argv, options] = args(spawn);
  const stateName = identifier(field(state, 'name'));
  const commandName = identifier(field(command, 'name'));
  const parametersName = identifier(field(parameters, 'name'));
  const setup = field(state, 'value');
  if (!scriptArgs || !stateName || !commandName || !parametersName || !setup ||
      new Set([scriptArgs, stateName, commandName, parametersName]).size !== 4 ||
      mentionsIdentifier(setup, scriptArgs) || otherParameters.some(node => mentionsIdentifier(node, scriptArgs)) ||
      constVariables(select).length !== 3 || launchVariables.length !== 1 ||
      !callsImport(spawn, imports, 'node:child_process', 'spawn') || args(spawn).length !== 3 ||
      identifier(programArg) !== commandName || identifier(argv) !== parametersName ||
      options?.type !== 'object' || mentionsIdentifier(options, parametersName) || named(options).some(node =>
        node.type !== 'pair' || !['cwd', 'env', 'detached', 'stdio'].includes(field(node, 'key')?.text))) return null;

  const [commands, argLists] = [field(command, 'value'), field(parameters, 'value')];
  if (![commands, argLists].every(node =>
    node?.type === 'ternary_expression' && identifier(field(node, 'condition')) === stateName)) return null;
  const callsPython = node => callee(node) === 'python' && args(node).length === 0;
  const forwardsArgs = nodes => nodes.length === 3 && literal(nodes[0]) === '-I' && literal(nodes[1]) === '-B' &&
    nodes[2]?.type === 'spread_element' && identifier(named(nodes[2])[0]) === scriptArgs;
  const direct = arrayElements(field(argLists, 'consequence'));
  const sandboxed = arrayElements(field(argLists, 'alternative'));
  const sandboxArgs = args(sandboxed[1]);
  if (callsPython(field(commands, 'consequence')) && literal(field(commands, 'alternative')) === '/usr/bin/sandbox-exec' &&
      forwardsArgs(direct) && literal(sandboxed[0]) === '-f' && callee(sandboxed[1]) === 'sandbox' &&
      sandboxArgs.length === 1 && identifier(sandboxArgs[0]) === 'data' &&
      callsPython(sandboxed[2]) && forwardsArgs(sandboxed.slice(3))) {
    return { line: line(spawn), interpreterLine: line(interpreter) };
  }
  return null;
}

function fileUses(program, imports) {
  const uses = new Map();
  for (const call of program.descendantsOfType('call_expression')) {
    const target = imports.get(callee(call));
    const first = args(call)[0];
    let kind, path, runnerModule;
    if (target?.source === 'node:fs' && target.name === 'readFileSync') {
      kind = 'static_json_read';
      path = first;
    } else if (target?.name === 'boundedProcess' && relativeModuleSpecifier.test(target.source)) {
      kind = 'python_helper_invocation';
      path = arrayElements(first)[0];
      runnerModule = target.source;
    } else {
      continue;
    }
    if (!callsImport(path, imports, 'node:path', 'resolve') || args(path).length !== 2) continue;
    const [base, suffix] = args(path);
    const root = imports.get(identifier(base));
    const specifier = literal(suffix);
    if (root?.name !== 'ROOT' || !relativeModuleSpecifier.test(root.source) || !specifier) continue;
    uses.set(call.startIndex, { kind, line: line(call), specifier, rootModule: root.source, runnerModule });
  }
  return [...uses.values()];
}

function syntaxTokens(node) {
  if (!node || node.type === 'comment') return [];
  if (node.type === 'string') return [JSON.stringify(literal(node))];
  return node.childCount ? node.children.flatMap(syntaxTokens) : [node.text];
}

const matchesSyntax = (node, shape) => syntaxTokens(node).join(' ') === shape;

function constructsImport(node, imports, source, name) {
  const imported = imports.get(identifier(field(node, 'constructor')));
  return node?.type === 'new_expression' && imported?.source === source && imported.name === name;
}

function launcherOnlyBinding(program, { imports, constants, definitions }) {
  // This is the qualifier's first-occurrence argv contract. The source
  // wrapper supplies both flags before forwarding the caller's arguments.
  const value = name => field(constants.get(name), 'value');
  if (definitions.has('process') || definitions.has('Object') ||
      !matchesSyntax(value('args'), 'Object . freeze ( process . argv . slice ( 2 ) )') ||
      !matchesSyntax(value('arg'),
        'name => { const index = args . indexOf ( "--" + name ) ; return index === - 1 ? undefined : args [ index + 1 ] ; }') ||
      !matchesSyntax(value('launcherOnly'), 'args . includes ( "--launcher-only" )')) return null;
  const root = value('appRoot');
  if (!callsImport(root, imports, 'node:path', 'resolve') || args(root).length !== 1 ||
      !matchesSyntax(args(root)[0], 'arg ( "app-root" )')) return null;
  const path = value('launcherPath');
  const [base, suffix] = args(path);
  const specifier = literal(suffix);
  if (!callsImport(path, imports, 'node:path', 'resolve') || args(path).length !== 2 ||
      identifier(base) !== 'appRoot' || !specifier) return null;

  const factory = value('launcherTransport');
  const transport = field(factory, 'body');
  const parameters = named(field(transport, 'arguments'));
  const options = named(parameters[0]);
  const command = options.filter(pair => field(pair, 'key')?.text === 'command');
  if (factory?.type !== 'arrow_function' || !matchesSyntax(field(factory, 'parameters'), '( )') ||
      !constructsImport(transport, imports, '@modelcontextprotocol/sdk/client/stdio.js', 'StdioClientTransport') ||
      parameters.length !== 1 || parameters[0]?.type !== 'object' ||
      options.some(pair => pair.type !== 'pair' || !['command', 'args', 'env'].includes(field(pair, 'key')?.text)) ||
      command.length !== 1 || identifier(field(command[0], 'value')) !== 'launcherPath') return null;

  const guard = named(program).find(node => node.type === 'if_statement' &&
    matchesSyntax(field(node, 'condition'), '( launcherOnly )'));
  const branch = named(field(guard, 'consequence'));
  const client = branch.flatMap(constVariables).find(entry => identifier(field(entry, 'name')) === 'launcherClient');
  const attempt = branch.find(node => node.type === 'try_statement');
  const firstStatement = named(field(attempt, 'body'))[0];
  const awaited = named(firstStatement)[0];
  const connect = named(awaited)[0];
  if (definitions.get('launcherClient')?.size !== 1 ||
      !constructsImport(field(client, 'value'), imports, '@modelcontextprotocol/sdk/client/index.js', 'Client') ||
      firstStatement?.type !== 'expression_statement' || awaited?.type !== 'await_expression' ||
      !matchesSyntax(field(connect, 'function'), 'launcherClient . connect') ||
      !matchesSyntax(args(connect)[0], 'launcherTransport ( )')) return null;
  return { specifier, line: line(path), argumentLine: line(root), connectLine: line(connect) };
}

export function agentosDependencyParser(core) {
  const builtin = core.builtinExtractors.find(extractor => extractor.languageIds.includes('javascript'));
  const extractor = {
    languageIds: ['javascript'],
    extractStructure(program) {
      const structure = builtin.extractStructure(program);
      const bindings = moduleBindings(program);
      return { ...structure, agentosFileBindings: {
        root: moduleRoot(bindings.exports.get('ROOT'), bindings.imports),
        runner: pythonRunner(program, bindings),
        launcher: launcherOnlyBinding(program, bindings),
        uses: fileUses(program, bindings.imports),
      } };
    },
    extractCallGraph: builtin.extractCallGraph.bind(builtin),
  };
  return new core.TreeSitterPlugin(core.builtinLanguageConfigs.filter(config => config.id === 'javascript'), [extractor]);
}
