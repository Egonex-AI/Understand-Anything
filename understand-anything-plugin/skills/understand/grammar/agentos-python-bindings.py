"""Recognize JSON Schema, audit, and registry bindings without executing Python.

Input is a JSON array of {path, source} records on stdin. Supported forms are
module-level calls, literal catalog tables, and an explicit default CLI input
passed to a validator in the same file. The caller checks the file identities
and content hashes before admitting an extracted binding.
"""

import ast
from collections import Counter
import json
import posixpath as path
import re
import sys


def name(node, value):
    return isinstance(node, ast.Name) and node.id == value


def literal(node, kind):
    return node.value if isinstance(node, ast.Constant) and type(node.value) is kind else None


def method(node, attr, argc, *, allow_keywords=False):
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == attr and len(node.args) == argc and (allow_keywords or not node.keywords))


def position(node):
    return (node.lineno, node.col_offset)


def unpack(node, size):
    return node.elts if isinstance(node, (ast.List, ast.Tuple)) and len(node.elts) == size else None


def imported_names(node):
    if isinstance(node, ast.Import):
        for alias in node.names:
            local = alias.asname or alias.name.split('.')[0]
            yield local, alias.name if alias.asname else local
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            qualified = f'{node.module}.{alias.name}' if node.level == 0 and node.module else None
            yield alias.asname or alias.name, qualified


def bound_names(node):
    if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
        yield node.id
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        yield from (local for local, _ in imported_names(node))
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.ExceptHandler)):
        if node.name:
            yield node.name
    elif type(node).__name__ in ('MatchAs', 'MatchStar') and node.name:
        yield node.name
    elif type(node).__name__ == 'MatchMapping' and node.rest:
        yield node.rest


def joined_path(base, tail):
    if (base is not None and tail and not path.isabs(tail) and '..' not in tail.split('/')
            and not any(c in tail for c in '\\:\0')):
        return path.normpath(path.join(base, tail))
    return None


def draft_validator(node, symbol):
    return (isinstance(node, ast.Call) and len(node.args) == 1
            and not isinstance(node.args[0], ast.Starred)
            and all(kw.arg == 'registry' for kw in node.keywords)
            and symbol(node.func) == 'jsonschema.Draft202012Validator')


class Bindings:
    def __init__(self, file, tree):
        self.file = file
        self.tree = tree
        self.parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        self.writes = Counter()
        self.attribute_writes = set()
        self.imports = {}
        self.values = {}
        self.wildcard_import = False
        for node in ast.walk(tree):
            self.writes.update(bound_names(node))
            if isinstance(node, ast.Attribute) and isinstance(node.ctx, (ast.Store, ast.Del)):
                self.attribute_writes.add(ast.dump(node.value) + '.' + node.attr)
            elif isinstance(node, ast.ImportFrom) and any(alias.name == '*' for alias in node.names):
                self.wildcard_import = True
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for local, qualified in imported_names(node):
                    if qualified:
                        self.imports[local] = (qualified, node)
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                self.values[node.targets[0].id] = (node.value, node)

    def symbol(self, node, before):
        if isinstance(node, ast.Name) and self.writes[node.id] == 1 and node.id in self.imports:
            qualified, stmt = self.imports[node.id]
            return qualified if position(stmt) < position(before) else None
        if isinstance(node, ast.Attribute):
            if ast.dump(node.value) + '.' + node.attr in self.attribute_writes:
                return None
            owner = self.symbol(node.value, before)
            return f'{owner}.{node.attr}' if owner else None
        return None

    def value(self, node, before):
        if isinstance(node, ast.Name) and self.writes[node.id] == 1 and node.id in self.values:
            value, stmt = self.values[node.id]
            if position(stmt) < position(before):
                return value, stmt
        return None, before

    def local_path(self, node, before):
        if isinstance(node, ast.Name):
            value, stmt = self.value(node, before)
            return self.local_path(value, stmt) if value else None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            return joined_path(self.local_path(node.left, before), literal(node.right, str))
        # Path(__file__).resolve().parent or .parents[N] is a source-relative anchor.
        anchor, distance = None, None
        if isinstance(node, ast.Attribute) and node.attr == 'parent':
            anchor, distance = node.value, 1
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) and node.value.attr == 'parents':
            index = literal(node.slice, int)
            if index is not None and index >= 0:
                anchor, distance = node.value.value, index + 1
        if not method(anchor, 'resolve', 0) or distance > len(self.file.split('/')):
            return None
        constructor = anchor.func.value
        if (isinstance(constructor, ast.Call) and len(constructor.args) == 1 and not constructor.keywords
                and self.symbol(constructor.func, before) == 'pathlib.Path'
                and name(constructor.args[0], '__file__') and not self.writes['__file__']):
            return '/'.join(self.file.split('/')[:-distance]) or '.'
        return None

    def json_read(self, node, before):
        """Return the path expression from json.loads(path.read_text())."""
        if (isinstance(node, ast.Call) and len(node.args) == 1 and not node.keywords
                and self.symbol(node.func, before) == 'json.loads' and method(node.args[0], 'read_text', 0)):
            return node.args[0].func.value
        return None

    def json_path(self, node, before):
        if isinstance(node, ast.Name):
            value, stmt = self.value(node, before)
            if value and any(ref is not node and name(ref, node.id) and isinstance(ref.ctx, ast.Load)
                             and position(stmt) < position(ref) < position(node) for ref in self.parents):
                return None  # The loaded object may have been mutated or escaped.
            return self.json_path(value, stmt) if value else None
        return self.local_path(self.json_read(node, before), before)

    def validator(self, node, before):
        return draft_validator(node, lambda expr: self.symbol(expr, before))

    def direct(self, call):
        if method(call, 'validate', 1) and self.validator(call.func.value, call):
            schema, record = call.func.value.args[0], call.args[0]
        elif (isinstance(call, ast.Call) and len(call.args) == 2 and not call.keywords
              and self.symbol(call.func, call) == 'jsonschema.validate'):
            record, schema = call.args
        else:
            return None
        schema_path, record_path = self.json_path(schema, call), self.json_path(record, call)
        if schema_path and record_path:
            return dict(kind='python_validator_call', line=call.lineno, schemaPath=schema_path, recordPath=record_path)
        return None

    def readonly_map(self, variable, catalog):
        for ref, parent in self.parents.items():
            if not name(ref, variable) or not isinstance(ref.ctx, ast.Load):
                continue
            if catalog:
                use = self.parents.get(parent)
                if (isinstance(parent, ast.Attribute) and parent.attr in ('items', 'values')
                        and method(use, parent.attr, 0) and use.func is parent):
                    continue
                if (isinstance(parent, ast.Call) and name(parent.func, 'len') and not self.writes['len']
                        and parent.args == [ref] and not parent.keywords):
                    continue
            elif isinstance(parent, ast.Subscript) and parent.value is ref and isinstance(parent.ctx, ast.Load):
                attr = self.parents.get(parent)
                use = self.parents.get(attr)
                if isinstance(attr, ast.Attribute) and attr.attr == 'validate' and method(use, 'validate', 1) and use.func is attr:
                    continue
            return False
        return True

    def catalog(self, validator_ref, before):
        """Prove validators[k] comes from an unambiguous local *.schema.json catalog."""
        validators, assign = self.value(validator_ref, before)
        if not isinstance(validators, ast.DictComp) or len(validators.generators) != 1:
            return None
        loop = validators.generators[0]
        pair = unpack(loop.target, 2)
        if (loop.ifs or loop.is_async or not pair or not all(isinstance(x, ast.Name) for x in pair)
                or pair[0].id == pair[1].id or not name(validators.key, pair[0].id)
                or not self.validator(validators.value, assign) or not name(validators.value.args[0], pair[1].id)
                or not method(loop.iter, 'items', 0) or not self.readonly_map(validator_ref.id, False)):
            return None
        catalog_ref = loop.iter.func.value
        schemas, assign = self.value(catalog_ref, assign)
        if not isinstance(schemas, ast.DictComp) or len(schemas.generators) != 1 or not self.readonly_map(catalog_ref.id, True):
            return None
        loop = schemas.generators[0]
        if (loop.ifs or loop.is_async or not isinstance(loop.target, ast.Name)
                or not method(loop.iter, 'glob', 1) or literal(loop.iter.args[0], str) != '*.schema.json'
                or not name(self.json_read(schemas.value, assign), loop.target.id)):
            return None
        key = schemas.key
        if (not isinstance(key, ast.Subscript) or literal(key.slice, int) != 0
                or not method(key.value, 'split', 1) or literal(key.value.args[0], str) != '.'
                or not isinstance(key.value.func.value, ast.Attribute) or key.value.func.value.attr != 'stem'
                or not name(key.value.func.value.value, loop.target.id)):
            return None
        directory = self.local_path(loop.iter.func.value, assign)
        return (directory, assign.lineno) if directory else None

    def table(self, loop):
        if not isinstance(loop, ast.For) or not isinstance(loop.iter, (ast.List, ast.Tuple)):
            return []
        pair = unpack(loop.target, 2)
        if not pair or not all(isinstance(x, ast.Name) for x in pair) or pair[0].id == pair[1].id:
            return []
        # The validation call must be first in the loop body, before either
        # loop variable can be reassigned. Remaining statements may count or log.
        if not loop.body or not isinstance(loop.body[0], ast.Expr):
            return []
        call = loop.body[0].value
        if not method(call, 'validate', 1) or not name(self.json_read(call.args[0], call), pair[1].id):
            return []
        receiver = call.func.value
        if not isinstance(receiver, ast.Subscript) or not name(receiver.slice, pair[0].id):
            return []
        catalog = self.catalog(receiver.value, call)
        if not catalog:
            return []
        directory, catalog_line = catalog
        bindings = []
        for row in loop.iter.elts:
            parts = unpack(row, 2)
            key, record = (literal(parts[0], str), self.local_path(parts[1], loop)) if parts else (None, None)
            if not key or not record:
                return []
            bindings.append(dict(kind='python_validator_table', line=call.lineno, bindingLine=row.lineno,
                                 catalogLine=catalog_line, catalogPath=directory, schemaKey=key, recordPath=record))
        return bindings

    def extract(self):
        if self.wildcard_import:
            return []
        results = []
        for stmt in self.tree.body:
            if isinstance(stmt, ast.Expr):
                binding = self.direct(stmt.value)
                if binding:
                    results.append(binding)
            results.extend(self.table(stmt))
        results.extend(cli_bindings(self))
        return results


def assignment(node):
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id, node.value
    return None, None


def statements(body, prior=(), guards=()):
    """Visit straight-line statements and the taken bodies of if and try blocks."""
    for stmt in body:
        yield stmt, prior, guards
        if isinstance(stmt, ast.If) and not (isinstance(stmt.test, ast.Constant) and not stmt.test.value):
            yield from statements(stmt.body, prior + (stmt.test,), guards + (stmt.test.lineno,))
        elif isinstance(stmt, ast.Try):
            yield from statements(stmt.body, prior, guards)
        if isinstance(stmt, (ast.Return, ast.Raise, ast.Break, ast.Continue)):
            break
        prior += (stmt,)


def signature(function):
    if not isinstance(function, ast.FunctionDef) or function.decorator_list:
        return None
    args = function.args
    if args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg:
        return None
    defaults = [None] * (len(args.args) - len(args.defaults)) + args.defaults
    return {arg.arg: default for arg, default in zip(args.args, defaults)}


def call_arguments(function, call):
    defaults = signature(function)
    if defaults is None or len(call.args) > len(defaults) or any(isinstance(x, ast.Starred) for x in call.args):
        return None
    given = dict(zip(defaults, call.args))
    for kw in call.keywords:
        if kw.arg not in defaults or kw.arg in given:
            return None
        given[kw.arg] = kw.value
    return (given, defaults) if all(var in given or default is not None for var, default in defaults.items()) else None


class LocalScope:
    """Find the latest explicit binding on one supported statement path."""
    def __init__(self, module, function):
        self.module = module
        self.locals = set(signature(function))
        for node in ast.walk(function):
            self.locals.update(node.names if isinstance(node, (ast.Global, ast.Nonlocal)) else bound_names(node))

    def definition(self, variable, prior):
        for i in range(len(prior) - 1, -1, -1):
            stmt = prior[i]
            if any(variable in bound_names(node) for node in ast.walk(stmt)):
                return stmt, prior[:i]
        return None, ()

    def symbol(self, node, prior):
        if isinstance(node, ast.Name) and node.id in self.locals:
            stmt, _ = self.definition(node.id, prior)
            matches = [value for local, value in imported_names(stmt) if local == node.id]
            return matches[0] if len(matches) == 1 else None
        if isinstance(node, ast.Attribute):
            if ast.dump(node.value) + '.' + node.attr in self.module.attribute_writes:
                return None
            owner = self.symbol(node.value, prior)
            return f'{owner}.{node.attr}' if owner else None
        return self.module.symbol(node, node) if isinstance(node, ast.Name) else None

    def builtin(self, node, variable):
        return name(node, variable) and variable not in self.locals and not self.module.writes[variable]

    def file_path(self, node, prior, parameter_paths):
        if isinstance(node, ast.Name) and node.id in self.locals:
            stmt, earlier = self.definition(node.id, prior)
            if stmt is None:
                return parameter_paths.get(node.id)
            variable, value = assignment(stmt)
            return self.file_path(value, earlier, parameter_paths) if variable == node.id else None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            return joined_path(self.file_path(node.left, prior, parameter_paths), literal(node.right, str))
        if method(node, 'resolve', 0):
            value = node.func.value
            if (isinstance(value, ast.Call) and len(value.args) == 1 and not value.keywords
                    and self.symbol(value.func, prior) == 'pathlib.Path'):
                return self.file_path(value.args[0], prior, parameter_paths)
        if node is not None and not any(isinstance(n, ast.Name) and n.id in self.locals for n in ast.walk(node)):
            return self.module.local_path(node, node)
        return None


def references(body, variable):
    return (node for stmt in body for node in ast.walk(stmt) if name(node, variable) and isinstance(node.ctx, ast.Load))


def keyword_values(call):
    values = {kw.arg: kw.value for kw in call.keywords}
    return values if None not in values and len(values) == len(call.keywords) else None


def cli_defaults(scope, namespace, prior):
    """Bind literal argparse path defaults from one unmodified parser and namespace."""
    parse, before_parse = scope.definition(namespace, prior)
    _, parse_args = assignment(parse)
    if not method(parse_args, 'parse_args', 0) or not isinstance(parse_args.func.value, ast.Name):
        return {}
    parser_name = parse_args.func.value.id
    parser, before_parser = scope.definition(parser_name, before_parse)
    _, constructor = assignment(parser)
    if (not isinstance(constructor, ast.Call) or constructor.args
            or scope.symbol(constructor.func, before_parser) != 'argparse.ArgumentParser'
            or any(kw.arg not in ('description', 'prog', 'epilog') for kw in constructor.keywords)):
        return {}

    options = set()
    defaults = {}
    for i in range(len(before_parser) + 1, len(before_parse)):
        stmt = before_parse[i]
        refs = list(references((stmt,), parser_name))
        if not refs:
            continue
        call = stmt.value if isinstance(stmt, ast.Expr) else None
        if not method(call, 'add_argument', 1, allow_keywords=True) or refs != [call.func.value]:
            return {}
        label = literal(call.args[0], str)
        keywords = keyword_values(call)
        if (not label or not re.fullmatch(r'(?:--[A-Za-z][A-Za-z0-9_-]*|[A-Za-z][A-Za-z0-9_]*)', label)
                or keywords is None or 'dest' in keywords):
            return {}
        optional = label.startswith('--')
        dest = label.removeprefix('--').replace('-', '_')
        if dest in options:
            return {}
        options.add(dest)
        if (keywords.keys() <= {'type', 'default', 'nargs', 'help', 'metavar'}
                and (optional and 'nargs' not in keywords or literal(keywords.get('nargs'), str) == '?')
                and scope.symbol(keywords.get('type'), before_parse[:i]) == 'pathlib.Path'):
            default = scope.file_path(keywords.get('default'), before_parse[:i], {})
            if default:
                defaults[dest] = (default, label, call.lineno)
    for ref in references(prior[len(before_parse) + 1:], namespace):
        access = scope.module.parents[ref]
        if not (isinstance(access, ast.Attribute) and isinstance(access.ctx, ast.Load) and access.attr in options):
            return {}
    return defaults


def default_path(scope, node, prior):
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return cli_defaults(scope, node.value.id, prior).get(node.attr)
    return None


def duplicate_rejecting_hook(function, pairs):
    """Accept an object hook that copies each pair unchanged or raises on duplicate keys."""
    if len(function.body) != 3:
        return False
    start, loop, end = function.body
    output, value = assignment(start)
    if not (isinstance(value, ast.Dict) and not value.keys and isinstance(loop, ast.For)
            and name(loop.iter, pairs) and len(loop.body) == 2 and not loop.orelse
            and isinstance(end, ast.Return) and name(end.value, output)):
        return False
    names = unpack(loop.target, 2)
    if not names or not all(isinstance(x, ast.Name) for x in names):
        return False
    key, item = (x.id for x in names)
    if len({output, pairs, key, item}) != 4:
        return False
    duplicate, put = loop.body
    test = duplicate.test if isinstance(duplicate, ast.If) else None
    target = put.targets[0] if isinstance(put, ast.Assign) and len(put.targets) == 1 else None
    return (isinstance(test, ast.Compare) and name(test.left, key) and len(test.ops) == 1
            and isinstance(test.ops[0], ast.In) and name(test.comparators[0], output)
            and not duplicate.orelse and len(duplicate.body) == 1 and isinstance(duplicate.body[0], ast.Raise)
            and isinstance(target, ast.Subscript) and name(target.value, output) and name(target.slice, key)
            and name(put.value, item))


def json_argument(scope, node, prior, *, allow_strict_hooks=False):
    if not (isinstance(node, ast.Call) and len(node.args) == 1
            and scope.symbol(node.func, prior) == 'json.loads'):
        return None
    if node.keywords and not allow_strict_hooks:
        return None
    keywords = keyword_values(node)
    if keywords is None or not keywords.keys() <= {'object_pairs_hook', 'parse_constant'}:
        return None
    for kind, ref in keywords.items():
        if not isinstance(ref, ast.Name):
            return None
        hook, _ = scope.definition(ref.id, prior)
        params = signature(hook)
        if params is None or list(params.values()) != [None]:
            return None
        if kind == 'object_pairs_hook':
            if not duplicate_rejecting_hook(hook, next(iter(params))):
                return None
        elif len(hook.body) != 1 or not isinstance(hook.body[0], ast.Raise):
            return None
    return node.args[0]


def cli_record(scope, value, prior):
    if isinstance(value, ast.Name):
        stmt, earlier = scope.definition(value.id, prior)
        variable, value_expr = assignment(stmt)
        if variable != value.id or any(references(prior[len(earlier) + 1:], variable)):
            return None
        value, prior = value_expr, earlier
    data = json_argument(scope, value, prior, allow_strict_hooks=True)
    if isinstance(data, ast.Name):
        stmt, prior = scope.definition(data.id, prior)
        variable, data_expr = assignment(stmt)
        data = data_expr if variable == data.id else None
    if not (method(data, 'read_text', 0) or method(data, 'read_bytes', 0)):
        return None
    default = default_path(scope, data.func.value, prior)
    if default:
        record, argument, line = default
        return dict(recordPath=record, argument=argument, argumentLine=line,
                    recordReadLine=data.lineno, jsonLoadLine=value.lineno)
    return None


def validator_site(scope, stmt, prior):
    # iter_errors is lazy. Only an explicit for loop or list call consumes it.
    expr = stmt.iter if isinstance(stmt, ast.For) else getattr(stmt, 'value', None)
    if isinstance(expr, ast.Call) and len(expr.args) == 1 and not expr.keywords and scope.builtin(expr.func, 'list'):
        expr, operation = expr.args[0], 'iter_errors'
    else:
        operation = 'iter_errors' if isinstance(stmt, ast.For) else 'validate'
    if method(expr, operation, 1) and draft_validator(expr.func.value, lambda ref: scope.symbol(ref, prior)):
        return expr, expr.func.value.args[0], expr.args[0]
    return None


def base_name(node):
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def writes_record(prior, variable):
    """Reject explicit rebinding, writes through the record, or simple escaping aliases."""
    for stmt in prior:
        for node in ast.walk(stmt):
            if variable in bound_names(node):
                return True
            if isinstance(node, (ast.Attribute, ast.Subscript)) and isinstance(node.ctx, (ast.Store, ast.Del)):
                if base_name(node) == variable:
                    return True
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if base_name(node.func.value) == variable and node.func.attr not in ('get', 'keys', 'values', 'items'):
                    return True
            if isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
                value = node.value
                if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr == 'get':
                    value = value.func.value
                if base_name(value) == variable:
                    return True
    return False


def cli_entry(module, functions):
    entries = []
    for stmt in module.tree.body:
        test = stmt.test if isinstance(stmt, ast.If) and not stmt.orelse and len(stmt.body) == 1 else None
        if not (isinstance(test, ast.Compare) and name(test.left, '__name__') and not module.writes['__name__']
                and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq) and literal(test.comparators[0], str) == '__main__'):
            continue
        action = stmt.body[0]
        call = action.value if isinstance(action, ast.Expr) else None
        if isinstance(action, ast.Raise) and not action.cause and isinstance(action.exc, ast.Call):
            outer = action.exc
            if name(outer.func, 'SystemExit') and not module.writes['SystemExit'] and len(outer.args) == 1 and not outer.keywords:
                call = outer.args[0]
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and not (call.args or call.keywords):
            function = functions.get(call.func.id)
            if signature(function) == {} and position(function) < position(stmt):
                entries.append((stmt, function))
    return entries[0] if len(entries) == 1 else (None, None)


def cli_bindings(module):
    functions = {node.name: node for node in module.tree.body
                 if isinstance(node, ast.FunctionDef) and module.writes[node.name] == 1}
    entry, main_function = cli_entry(module, functions)
    if main_function is None:
        return
    caller = LocalScope(module, main_function)
    for stmt, before_call, call_guards in statements(main_function.body):
        call = getattr(stmt, 'value', None)
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id not in caller.locals):
            continue
        function = functions.get(call.func.id)
        args = call_arguments(function, call)
        if args is None or function is main_function or position(function) > position(entry):
            continue
        given, defaults = args
        records = {var: cli_record(caller, expr, before_call) for var, expr in given.items()}
        if not any(records.values()):
            continue
        paths = {var: module.local_path(expr, function) for var, expr in defaults.items() if var not in given}
        for var, expr in given.items():
            default = default_path(caller, expr, before_call)
            paths[var] = default[0] if default else caller.file_path(expr, before_call, {})
        callee = LocalScope(module, function)
        for step, prior, guards in statements(function.body):
            site = validator_site(callee, step, prior)
            if not site:
                continue
            validate, schema, record = site
            record_binding = records.get(record.id) if isinstance(record, ast.Name) else None
            if (not record_binding or writes_record(prior, record.id)
                    or any(references((validate.func.value,), record.id))):
                continue
            if isinstance(schema, ast.Name):
                schema_stmt, earlier = callee.definition(schema.id, prior)
                variable, value = assignment(schema_stmt)
                if variable != schema.id:
                    continue
                # A schema self-check preserves the loaded document. Other uses
                # could mutate or replace it before this validation call.
                if any(not schema_self_check(callee, ref, prior) for ref in references(prior[len(earlier) + 1:], variable)):
                    continue
                schema, prior = value, earlier
            read = json_argument(callee, schema, prior)
            if not method(read, 'read_text', 0):
                continue
            schema_path = callee.file_path(read.func.value, prior, paths)
            if schema_path:
                yield dict(record_binding, kind='python_cli_default', schemaPath=schema_path,
                           line=validate.lineno, schemaReadLine=read.lineno, dispatchLine=call.lineno,
                           validatorDefinitionLine=function.lineno, entrypointLine=entry.lineno,
                           guardLines=[*call_guards, *guards])


def schema_self_check(scope, ref, prior):
    call = scope.module.parents[ref]
    return (method(call, 'check_schema', 1) and call.args[0] is ref
            and scope.symbol(call.func.value, prior) == 'jsonschema.Draft202012Validator')


AUDIT_METHODS = {
    'log_routing_event': ('RoutingEventRecord', 'routing_events', 'event_id'),
    'log_storage_action': ('StorageActionRecord', 'storage_actions', 'action_id'),
    'get_routing_events': ('RoutingEventRecord', 'routing_events', 'event_id'),
}


def audit_body(function):
    body = function.body
    if body and isinstance(body[0], ast.Expr) and literal(body[0].value, str) is not None:
        return body[1:]
    return body


def member(node, owner, attribute):
    return isinstance(node, ast.Attribute) and node.attr == attribute and name(node.value, owner)


def call_on(node, owner, operation, argc):
    return method(node, operation, argc) and name(node.func.value, owner)


def expression(stmt):
    return stmt.value if isinstance(stmt, ast.Expr) else None


def audit_connection(scope, stmt, receiver):
    conn, call = assignment(stmt)
    if (conn and method(call, 'connect', 1) and scope.symbol(call.func, ()) == 'sqlite3.connect'
            and member(call.args[0], receiver, 'db_path')):
        return conn
    return None


def audit_writes(function):
    return Counter(identifier for node in ast.walk(function) for identifier in bound_names(node))


def audit_insert_binds_identity(call, record, table, identity, *, postgres=False):
    prefix = r'\s*INSERT\s+INTO' if postgres else r'\s*INSERT(?:\s+OR\s+REPLACE)?\s+INTO'
    conflict = r'(?:\s+ON\s+CONFLICT\s*\((\w+)\)\s+DO\s+UPDATE\s+SET\s+([\w\s=.,]+))?' if postgres else ''
    insert = re.fullmatch(prefix + r'\s+(\w+)\s*\(([^()]*)\)\s*VALUES\s*\(([^()]*)\)' + conflict + r'\s*',
                          literal(call.args[0], str) or '', re.IGNORECASE)
    if not insert or insert[1].lower() != table:
        return False
    columns = [column.strip().lower() for column in insert[2].split(',')]
    values = unpack(call.args[1], len(columns))
    placeholder = '%s' if postgres else '?'
    if (columns.count(identity) != 1 or not values or any(isinstance(value, ast.Starred) for value in values)
            or [slot.strip() for slot in insert[3].split(',')] != [placeholder] * len(columns)
            or not member(values[columns.index(identity)], record, identity)):
        return False
    if postgres and insert[4]:
        # The upsert must keep the identity that was bound in VALUES.
        updates = [re.fullmatch(r'\s*(\w+)\s*=\s*EXCLUDED\.\1\s*', part, re.IGNORECASE)
                   for part in insert[5].split(',')]
        if insert[4].lower() != identity or any(
                not update or update[1].lower() not in columns or update[1].lower() == identity for update in updates):
            return False
    return True


def audit_write(module, function, receiver, record, table, identity):
    body = audit_body(function)
    if len(body) < 4 or any(not isinstance(stmt, (ast.Assign, ast.AnnAssign)) for stmt in body[:-4]):
        return None
    connection, execute, commit, close = body[-4:]
    conn = audit_connection(LocalScope(module, function), connection, receiver)
    writes = audit_writes(function)
    call = expression(execute)
    if (not conn or writes[conn] != 1 or writes[record] or writes[receiver]
            or not call_on(call, conn, 'execute', 2) or not call_on(expression(commit), conn, 'commit', 0)
            or not call_on(expression(close), conn, 'close', 0)
            or not audit_insert_binds_identity(call, record, table, identity)):
        return None
    return dict(kind='sqlite_audit_write', line=call.lineno, commitLine=commit.lineno)


def postgres_connection(scope, transaction, prior, owner, *, url_parameter=False):
    if not isinstance(transaction, ast.With) or len(transaction.items) != 1 or len(transaction.body) != 1:
        return None
    item = transaction.items[0]
    call = item.context_expr
    if (not isinstance(call, ast.Call) or len(call.args) != 1 or call.keywords
            or scope.symbol(call.func, prior) != 'psycopg.connect' or not isinstance(item.optional_vars, ast.Name)):
        return None
    url = call.args[0]
    matches_url = name(url, owner) if url_parameter else member(url, owner, 'database_url')
    return item.optional_vars.id if matches_url else None


def postgres_audit_write(module, function, receiver, record, table, identity):
    body = audit_body(function)
    delegation = {}
    dispatch = expression(body[0]) if len(body) == 1 else None
    if isinstance(dispatch, ast.Call) and isinstance(dispatch.func, ast.Name):
        target = dispatch.func.id
        if (len(dispatch.args) != 2 or dispatch.keywords
                or not member(dispatch.args[0], receiver, 'database_url') or not name(dispatch.args[1], record)
                or module.writes[target] != 1 or target in LocalScope(module, function).locals):
            return None
        helper = next((stmt for stmt in module.tree.body
                       if isinstance(stmt, ast.FunctionDef) and stmt.name == target), None)
        parameters = signature(helper)
        if not parameters or len(parameters) != 2:
            return None
        receiver, record = parameters
        function = helper
        body = audit_body(helper)
        delegation = dict(dispatchLine=dispatch.lineno, helperLine=helper.lineno)
    if not body:
        return None
    *prior, transaction = body
    if any(not isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.Import, ast.ImportFrom)) for stmt in prior):
        return None
    conn = postgres_connection(LocalScope(module, function), transaction, prior, receiver,
                               url_parameter=bool(delegation))
    if not conn:
        return None
    writes = audit_writes(function)
    call = expression(transaction.body[0])
    if (writes[conn] != 1 or writes[record] or writes[receiver] or not call_on(call, conn, 'execute', 2)
            or not audit_insert_binds_identity(call, record, table, identity, postgres=True)):
        return None
    return dict(kind='postgres_audit_write', line=call.lineno, transactionLine=transaction.lineno, **delegation)


def audit_read(module, function, receiver, record_type, table, identity):
    body = audit_body(function)
    if len(body) < 4:
        return None
    results_stmt, loop, returned = body[-3:]
    scope = LocalScope(module, function)
    postgres = isinstance(body[-4], ast.With)
    if postgres:
        head = body[:-4]
        transaction = body[-4]
        conn = postgres_connection(scope, transaction, head, receiver)
        if not conn:
            return None
        rows, fetch = assignment(transaction.body[0])
        call = fetch.func.value if method(fetch, 'fetchall', 0) else None
        if not call_on(call, conn, 'execute', 2) or not isinstance(call.args[0], ast.Name):
            return None
        definitions = [stmt for stmt in head if assignment(stmt)[0] == call.args[0].id]
        if len(definitions) != 1:
            return None
        query_stmt = definitions[0]
        single_bindings = (conn, rows)
    else:
        if len(body) < 9:
            return None
        connection, query_stmt = body[:2]
        cursor_stmt, execute, rows_stmt, close = body[-7:-3]
        head = body[2:-7]
        conn = audit_connection(scope, connection, receiver)
        cursor, cursor_call = assignment(cursor_stmt)
        rows, fetch = assignment(rows_stmt)
        call = expression(execute)
        if (not conn or not cursor or not call_on(cursor_call, conn, 'cursor', 0)
                or not call_on(call, cursor, 'execute', 2) or not call_on(fetch, cursor, 'fetchall', 0)
                or not call_on(expression(close), conn, 'close', 0)):
            return None
        single_bindings = (conn, cursor, rows)

    query, statement = assignment(query_stmt)
    results, empty = assignment(results_stmt)
    row = loop.target.id if isinstance(loop, ast.For) and isinstance(loop.target, ast.Name) else None
    writes = audit_writes(function)
    if (not all((query, results, row, *single_bindings))
            or any(writes[var] != 1 for var in (*single_bindings, results, row)) or writes[receiver]
            or not name(call.args[0], query) or not isinstance(empty, ast.List) or empty.elts
            or not name(loop.iter, rows) or not isinstance(returned, ast.Return) or not name(returned.value, results)):
        return None
    select = re.fullmatch(r'\s*SELECT\s+([\w,\s]+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+1=1)?\s*',
                          literal(statement, str) or '', re.IGNORECASE)
    if not select or select[2].lower() != table:
        return None
    columns = [column.strip().lower() for column in select[1].split(',')]
    if columns.count(identity) != 1:
        return None
    placeholder = '%s' if postgres else r'\?'
    suffix = r'\s+(?:AND\s+\w+\s+(?:=|>=)\s+' + placeholder + r'|ORDER BY\s+\w+\s+(?:ASC|DESC))'
    for ref in ast.walk(function):
        if not name(ref, query) or not isinstance(ref.ctx, (ast.Store, ast.Del)):
            continue
        write = module.parents[ref]
        if write is query_stmt:
            continue
        if (not isinstance(write, ast.AugAssign) or not isinstance(write.op, ast.Add)
                or not re.fullmatch(suffix, literal(write.value, str) or '', re.IGNORECASE)):
            return None
    if any(isinstance(stmt, (ast.Return, ast.Raise)) for root in head for stmt in ast.walk(root)):
        return None
    if loop.orelse or any(not isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.ImportFrom)) for stmt in loop.body[:-1]):
        return None
    append = expression(loop.body[-1])
    if not call_on(append, results, 'append', 1):
        return None
    record = append.args[0]
    if not isinstance(record, ast.Call) or scope.symbol(record.func, ()) != f'.base.{record_type}':
        return None
    fields = [keyword.value for keyword in record.keywords if keyword.arg == identity]
    if (len(fields) != 1 or not isinstance(fields[0], ast.Subscript) or not name(fields[0].value, row)
            or literal(fields[0].slice, int) != columns.index(identity)):
        return None
    proof = dict(kind='sqlite_audit_read', line=call.lineno, recordConstructionLine=record.lineno)
    if postgres:
        proof.update(kind='postgres_audit_read', transactionLine=transaction.lineno)
    return proof


def register_audit_imports(module, module_name):
    for stmt in module.tree.body:
        if isinstance(stmt, ast.ImportFrom) and stmt.level == 1 and stmt.module == module_name:
            for alias in stmt.names:
                module.imports[alias.asname or alias.name] = (f'.{module_name}.{alias.name}', stmt)


def audit_class(tree, writes, class_name):
    if writes[class_name] != 1:
        return None
    return next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name), None)


def audit_record_class(record_tree, record_writes, record_type, identity):
    record = audit_class(record_tree, record_writes, record_type)
    if record and any(isinstance(field, ast.AnnAssign) and name(field.target, identity) for field in record.body):
        return record
    return None


def audit_bindings(module, record_tree):
    if module.wildcard_import:
        return
    register_audit_imports(module, 'base')
    record_writes = Counter(identifier for node in ast.walk(record_tree) for identifier in bound_names(node))
    for adapter in module.tree.body:
        if (not isinstance(adapter, ast.ClassDef) or adapter.decorator_list or module.writes[adapter.name] != 1
                or not any(module.symbol(base, adapter) in ('.base.RoutingAdapter', '.base.StorageAdapter')
                           for base in adapter.bases)):
            continue
        definitions = Counter(identifier for stmt in adapter.body for node in ast.walk(stmt) for identifier in bound_names(node))
        for function in adapter.body:
            parameters = signature(function)
            if not parameters or function.name not in AUDIT_METHODS or definitions[function.name] != 1:
                continue
            record_type, table, identity = AUDIT_METHODS[function.name]
            read = function.name == 'get_routing_events'
            annotation = function.returns if read else function.args.args[-1].annotation
            if read:
                annotation = annotation.slice if (isinstance(annotation, ast.Subscript)
                    and name(annotation.value, 'list') and not module.writes['list']) else None
            elif len(parameters) != 2:
                continue
            if module.symbol(annotation, function) != f'.base.{record_type}':
                continue
            record_class = audit_record_class(record_tree, record_writes, record_type, identity)
            if not record_class:
                continue
            receiver = function.args.args[0].arg
            if read:
                proof = audit_read(module, function, receiver, record_type, table, identity)
            else:
                record = function.args.args[1].arg
                proof = (audit_write(module, function, receiver, record, table, identity)
                         or postgres_audit_write(module, function, receiver, record, table, identity))
            body = audit_body(function)
            reason = 'unimplemented_audit_method' if len(body) == 1 and isinstance(body[0], ast.Raise) else 'unverified_audit_binding'
            yield dict(observerClass=adapter.name, recordClass=record_type, recordLine=record_class.lineno,
                       method=function.name, methodLine=function.lineno, table=table, identityColumn=identity,
                       **(proof or dict(reason=reason)))


AUDIT_PRODUCERS = {
    'StorageEngine': ('StorageAdapter', 'log_storage_action'),
    'RoutingEngine': ('RoutingAdapter', 'log_routing_event'),
}


def producer_adapter_assignment(module, engine, adapter_type, definitions):
    if definitions['__init__'] != 1:
        return None
    constructor = next((stmt for stmt in engine.body if isinstance(stmt, ast.FunctionDef) and stmt.name == '__init__'), None)
    if not signature(constructor):
        return None
    receiver = constructor.args.args[0].arg
    slots = [node for node in ast.walk(engine) if isinstance(node, ast.Attribute) and node.attr == 'adapter'
             and isinstance(node.ctx, (ast.Store, ast.Del))]
    if len(slots) != 1 or not member(slots[0], receiver, 'adapter'):
        return None
    binding = module.parents[slots[0]]
    if not isinstance(binding, ast.Assign) or audit_body(constructor)[:1] != [binding] or binding.targets != slots:
        return None
    writes = audit_writes(constructor)
    for arg in constructor.args.args[1:]:
        if (name(binding.value, arg.arg) and not writes[arg.arg] and not writes[receiver]
                and module.symbol(arg.annotation, constructor) == f'.adapters.base.{adapter_type}'):
            return binding
    return None


def storage_record_provider(adapter, record_type):
    definitions = Counter(identifier for stmt in adapter.body for node in ast.walk(stmt) for identifier in bound_names(node))
    if definitions['write_artifact'] != 1:
        return None
    return next((stmt for stmt in adapter.body if isinstance(stmt, ast.FunctionDef)
                 and stmt.name == 'write_artifact' and name(stmt.returns, record_type)), None)


def audit_adapter_call(call, receiver, operation):
    return (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
            and call.func.attr == operation and member(call.func.value, receiver, 'adapter'))


def audit_record_origin(scope, prior, value, receiver, record_type, identity, provider):
    if not isinstance(value, ast.Name):
        return None
    definition, earlier = scope.definition(value.id, prior)
    variable, call = assignment(definition)
    if variable != value.id or not isinstance(call, ast.Call):
        return None
    if scope.symbol(call.func, earlier) == f'.adapters.base.{record_type}':
        fields = keyword_values(call)
        if fields and identity in fields:
            return dict(kind='constructor', line=call.lineno)
    if provider and audit_adapter_call(call, receiver, provider.name):
        return dict(kind='adapter_return', line=call.lineno, method=f'StorageAdapter.{provider.name}',
                    contractLine=provider.lineno)
    return None


def audit_production_bindings(module, record_tree):
    if module.wildcard_import:
        return
    register_audit_imports(module, 'adapters.base')
    record_writes = Counter(identifier for node in ast.walk(record_tree) for identifier in bound_names(node))
    for engine in module.tree.body:
        if (not isinstance(engine, ast.ClassDef) or engine.name not in AUDIT_PRODUCERS
                or engine.decorator_list or module.writes[engine.name] != 1):
            continue
        adapter_type, sink = AUDIT_PRODUCERS[engine.name]
        record_type, _, identity = AUDIT_METHODS[sink]
        record_class = audit_record_class(record_tree, record_writes, record_type, identity)
        adapter_class = audit_class(record_tree, record_writes, adapter_type)
        if not record_class or not adapter_class:
            continue
        definitions = Counter(identifier for stmt in engine.body for node in ast.walk(stmt) for identifier in bound_names(node))
        adapter = producer_adapter_assignment(module, engine, adapter_type, definitions)
        if not adapter:
            continue
        provider = storage_record_provider(adapter_class, record_type) if adapter_type == 'StorageAdapter' else None
        for function in engine.body:
            if (not signature(function) or definitions[function.name] != 1
                    or not isinstance(function.returns, ast.Name)
                    or module.symbol(function.returns, function) != f'.adapters.base.{record_type}'):
                continue
            receiver = function.args.args[0].arg
            if audit_writes(function)[receiver]:
                continue
            scope = LocalScope(module, function)
            import_stmt = module.imports[function.returns.id][1]
            for stmt, prior, guards in statements(audit_body(function)):
                call = expression(stmt)
                if not audit_adapter_call(call, receiver, sink) or len(call.args) != 1 or call.keywords:
                    continue
                origin = audit_record_origin(scope, prior, call.args[0], receiver, record_type, identity, provider)
                yield dict(producerClass=engine.name, recordClass=record_type, recordLine=record_class.lineno,
                           method=function.name, methodLine=function.lineno, sink=sink, identityField=identity,
                           line=call.lineno, adapterBindingLine=adapter.lineno, recordImportLine=import_stmt.lineno,
                           guardLines=list(guards),
                           **(dict(kind='audit_record_emission', origin=origin) if origin
                              else dict(reason='unverified_audit_emission')))


def acceptance_registry_path(scope, node, prior):
    """Resolve paths rooted at the documented tests directory's package root."""
    if isinstance(node, ast.Name):
        definition, earlier = scope.definition(node.id, prior)
        variable, value = assignment(definition)
        return acceptance_registry_path(scope, value, earlier) if variable == node.id else None
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return joined_path(acceptance_registry_path(scope, node.left, prior), literal(node.right, str))
    root = node
    for _ in range(2):
        if not isinstance(root, ast.Attribute) or root.attr != 'parent':
            return None
        root = root.value
    if (isinstance(root, ast.Call) and len(root.args) == 1 and not root.keywords
            and scope.symbol(root.func, prior) == 'pathlib.Path' and scope.builtin(root.args[0], '__file__')):
        return '.'
    return None


def registry_open(scope, statement, prior):
    if not isinstance(statement, ast.With) or len(statement.items) != 1 or len(statement.body) != 1:
        return None
    item = statement.items[0]
    opened = item.context_expr
    if (not isinstance(opened, ast.Call) or not scope.builtin(opened.func, 'open') or opened.keywords
            or len(opened.args) not in (1, 2) or not isinstance(item.optional_vars, ast.Name)
            or len(opened.args) == 2 and literal(opened.args[1], str) not in ('r', 'rt')):
        return None
    return opened, item.optional_vars.id


def json_file_load(scope, decoded, handle, prior):
    return (isinstance(decoded, ast.Call) and len(decoded.args) == 1 and not decoded.keywords
            and scope.symbol(decoded.func, prior) == 'json.load' and name(decoded.args[0], handle))


def acceptance_registry_read(scope, value, prior):
    if not isinstance(value, ast.Name):
        return None
    definition, earlier = scope.definition(value.id, prior)
    reader = registry_open(scope, definition, earlier)
    if not reader or any(references(prior[len(earlier) + 1:], value.id)):
        return None
    opened, handle = reader
    variable, decoded = assignment(definition.body[0])
    if variable != value.id or not json_file_load(scope, decoded, handle, earlier):
        return None
    registry = acceptance_registry_path(scope, opened.args[0], earlier)
    if registry:
        return dict(packageRegistryPath=registry, openLine=opened.lineno, jsonLoadLine=decoded.lineno)
    return None


def registry_collection_read(loader, field):
    parameters = signature(loader)
    if not parameters or len(parameters) != 2:
        return None
    receiver, data = parameters
    writes = audit_writes(loader)
    if writes[receiver] or writes[data]:
        return None
    for stmt, _, guards in statements(audit_body(loader)):
        if guards:
            continue
        target, lookup = None, None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            target, lookup = stmt.targets[0], stmt.value
        elif isinstance(stmt, ast.For) and isinstance(stmt.target, ast.Name) and len(stmt.body) == 1:
            save = stmt.body[0]
            if (isinstance(save, ast.Assign) and len(save.targets) == 1 and name(save.value, stmt.target.id)
                    and isinstance(save.targets[0], ast.Subscript)):
                target, lookup = save.targets[0].value, stmt.iter
        if (isinstance(target, ast.Attribute) and name(target.value, receiver)
                and call_on(lookup, data, 'get', 2) and literal(lookup.args[0], str) == field):
            return lookup
    return None


def engine_registry_loader(module, engine_name, parameter, field, path_parameter=None):
    engine = audit_class(module.tree, module.writes, engine_name)
    if not engine or engine.decorator_list:
        return None
    definitions = Counter(identifier for stmt in engine.body for node in ast.walk(stmt) for identifier in bound_names(node))
    methods = {stmt.name: stmt for stmt in engine.body
               if isinstance(stmt, ast.FunctionDef) and definitions[stmt.name] == 1}
    constructor = methods.get('__init__')
    parameters = signature(constructor)
    if not parameters or parameter not in parameters:
        return None
    if path_parameter:
        default = parameters[parameter]
        if path_parameter not in parameters or not isinstance(default, ast.Constant) or default.value is not None:
            return None
    receiver = constructor.args.args[0].arg
    writes = audit_writes(constructor)
    if writes[parameter] or writes[receiver] or writes[path_parameter]:
        return None
    scope = LocalScope(module, constructor)
    for stmt, prior, guards in statements(audit_body(constructor)):
        if guards or not isinstance(stmt, ast.If) or not name(stmt.test, parameter) or len(stmt.body) != 1:
            continue
        path_evidence = {}
        if path_parameter:
            branch = stmt.orelse[0] if len(stmt.orelse) == 1 else None
            if not isinstance(branch, ast.If) or not name(branch.test, path_parameter) or len(branch.body) != 1:
                continue
            with_file = branch.body[0]
            reader = registry_open(scope, with_file, prior)
            if not reader or not name(reader[0].args[0], path_parameter):
                continue
            opened, handle = reader
            load = expression(with_file.body[0])
        else:
            load = expression(stmt.body[0])
        if (not isinstance(load, ast.Call) or not isinstance(load.func, ast.Attribute)
                or not name(load.func.value, receiver) or len(load.args) != 1 or load.keywords
                or ast.dump(load.func.value) + '.' + load.func.attr in module.attribute_writes):
            continue
        if path_parameter:
            decoded = load.args[0]
            if not json_file_load(scope, decoded, handle, prior):
                continue
            path_evidence = dict(pathGuardLine=branch.lineno, openLine=opened.lineno, jsonLoadLine=decoded.lineno)
        elif not name(load.args[0], parameter):
            continue
        loader = methods.get(load.func.attr)
        collection = registry_collection_read(loader, field)
        if collection:
            return dict(line=constructor.lineno, loadCallLine=load.lineno, loaderLine=loader.lineno,
                        collectionReadLine=collection.lineno, collection=field, **path_evidence)
    return None


def registry_constructor_calls(scope, function, engine_import):
    module = scope.module
    for stmt, prior, guards in statements(audit_body(function)):
        call = stmt.value if isinstance(stmt, ast.Assign) else expression(stmt)
        if (guards or not isinstance(call, ast.Call) or call.args or not isinstance(call.func, ast.Name)
                or call.func.id in scope.locals or module.symbol(call.func, call) != engine_import):
            continue
        arguments = keyword_values(call)
        if arguments:
            yield call, arguments, prior


def runtime_package_lines(item):
    bindings = []
    for source in item['packageSources']:
        package = Bindings(source['path'], ast.parse(source['source'], filename=source['path']))
        body = audit_body(package.tree)
        if len(body) != 2 or not isinstance(body[0], ast.ImportFrom):
            return None
        append = expression(body[1])
        if not call_on(append, '__path__', 'append', 1):
            return None
        text = append.args[0]
        if (not isinstance(text, ast.Call) or not name(text.func, 'str') or package.writes['str']
                or len(text.args) != 1 or text.keywords or package.local_path(text.args[0], text) != item['directory']):
            return None
        bindings.append(dict(filePath=source['path'], line=append.lineno))
    return bindings


def registry_preflight_site(module, validator, parameters):
    """Match a straight-line local schema load and fail-closed validation helper."""
    body = audit_body(validator)
    if len(body) != 5:
        return None
    *prior, attempt = body
    scope = LocalScope(module, validator)
    if not (isinstance(attempt, ast.Try) and len(attempt.body) == len(attempt.handlers) == 1
            and not (attempt.orelse or attempt.finalbody) and isinstance(attempt.body[0], ast.Expr)):
        return None
    handler = attempt.handlers[0]
    if scope.symbol(handler.type, prior) != 'jsonschema.ValidationError' or len(handler.body) != 1:
        return None
    failure = handler.body[0]
    if not (isinstance(failure, ast.Raise) and isinstance(failure.exc, ast.Call)
            and scope.builtin(failure.exc.func, 'SystemExit')):
        return None
    site = validator_site(scope, attempt.body[0], prior)
    if not site:
        return None
    validation, wrapper, record = site
    keywords = keyword_values(validation.func.value)
    schemas, registration = assignment(prior[-1])
    if not (keywords and schemas and name(keywords.get('registry'), schemas)
            and method(registration, 'with_resource', 2)):
        return None
    registry = registration.func.value
    uri, resource = registration.args
    if not (isinstance(registry, ast.Call) and not (registry.args or registry.keywords)
            and scope.symbol(registry.func, prior[:-1]) == 'referencing.Registry'
            and isinstance(uri, ast.Subscript) and literal(uri.slice, str) == '$id'
            and isinstance(resource, ast.Call) and len(resource.args) == 1 and not resource.keywords
            and isinstance(uri.value, ast.Name) and name(resource.args[0], uri.value.id)
            and scope.symbol(resource.func, prior[:-1]) == 'referencing.Resource.from_contents'):
        return None

    reads = {}
    for index, stmt in enumerate(prior[:-1]):
        variable, decoded = assignment(stmt)
        read = json_argument(scope, decoded, prior[:index])
        if not (variable and variable not in parameters and variable != schemas
                and method(read, 'read_text', 0, allow_keywords=True)
                and (not read.keywords or len(read.keywords) == 1 and read.keywords[0].arg == 'encoding'
                     and literal(read.keywords[0].value, str) == 'utf-8')
                and isinstance(read.func.value, ast.Name) and read.func.value.id in parameters):
            return None
        reads[variable] = (read.func.value.id, read.lineno)
    roles = {'record': record, 'wrapper': wrapper, 'itemSchema': uri.value}
    if len(reads) != len(roles) or not all(isinstance(ref, ast.Name) and ref.id in reads for ref in roles.values()):
        return None
    bound = {role: reads[ref.id] for role, ref in roles.items()}
    if len({parameter for parameter, _ in bound.values()}) != len(roles):
        return None
    return bound, dict(line=validation.lineno, validatorDefinitionLine=validator.lineno,
                       resourceRegistrationLine=registration.lineno, failureLine=failure.lineno)


def startup_registry_validations(module, functions, entry, function, scope):
    initializers = {
        'engine.storage_engine.StorageEngine', 'engine.routing_engine.RoutingEngine',
        'engine.adapters.local_storage_adapter.LocalStorageAdapter',
        'engine.adapters.local_routing_adapter.LocalRoutingAdapter',
    }
    first_init = min((position(node) for node in ast.walk(function)
                      if isinstance(node, ast.Call) and module.symbol(node.func, node) in initializers),
                     default=None)
    if first_init is None:
        return
    body = audit_body(function)
    for index, stmt in enumerate(body):
        if position(stmt) >= first_init or isinstance(stmt, (ast.Return, ast.Raise)):
            break
        call = expression(stmt)
        if (not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name)
                or call.func.id in scope.locals):
            continue
        validator = functions.get(call.func.id)
        args = call_arguments(validator, call)
        if args is None or position(validator) > position(entry):
            continue
        given, parameters = args
        site = registry_preflight_site(module, validator, parameters)
        if not site:
            continue
        bound, evidence = site
        prior = body[:index]
        paths = {f'{role}Path': scope.file_path(given.get(parameter), prior, {}) for role, (parameter, _) in bound.items()}
        if all(paths.values()):
            yield dict(**paths, **{f'{role}ReadLine': line for role, (_, line) in bound.items()}, **evidence,
                       startupCallLine=call.lineno, entrypointLine=entry.lineno, initializationLine=first_init[0])


def runtime_registry_bindings(module, item, loader):
    functions = {node.name: node for node in module.tree.body
                 if isinstance(node, ast.FunctionDef) and module.writes[node.name] == 1}
    entry, function = cli_entry(module, functions)
    if function is None:
        return
    packages = runtime_package_lines(item)
    if not packages:
        return
    scope = LocalScope(module, function)
    validations = list(startup_registry_validations(module, functions, entry, function, scope))
    parameter = item['pathParameter']
    for call, arguments, prior in registry_constructor_calls(scope, function, item['engineImport']):
        if item['parameter'] in arguments:
            continue  # The data argument takes precedence over the file path.
        value = arguments.get(parameter)
        if (not isinstance(value, ast.Call) or not scope.builtin(value.func, 'str')
                or len(value.args) != 1 or value.keywords):
            continue
        registry = scope.file_path(value.args[0], prior, {})
        if registry:
            yield dict(engineName=item['engineName'], entrypointLine=entry.lineno, entryFunction=function.name,
                       entryFunctionLine=function.lineno, importLine=module.imports[call.func.id][1].lineno,
                       line=call.lineno, parameter=parameter, resolvedRegistryPath=registry, packageBindings=packages,
                       registryValidations=[site for site in validations if site['recordPath'] == registry],
                       **(dict(kind='python_runtime_registry_load', loader=loader) if loader
                          else dict(reason='unverified_registry_loader')))


def registry_consumption_bindings(module, item):
    if module.wildcard_import:
        return
    engine_tree = ast.parse(item['engineSource'], filename=item['enginePath'])
    engine_module = Bindings(item['enginePath'], engine_tree)
    loader = engine_registry_loader(engine_module, item['engineName'], item['parameter'], item['collection'],
                                    item.get('pathParameter'))
    if item.get('pathParameter'):
        yield from runtime_registry_bindings(module, item, loader)
        return
    for test_class in module.tree.body:
        if (not isinstance(test_class, ast.ClassDef) or test_class.decorator_list or module.writes[test_class.name] != 1
                or not any(module.symbol(base, test_class) == 'unittest.TestCase' for base in test_class.bases)):
            continue
        setups = [stmt for stmt in test_class.body if isinstance(stmt, ast.FunctionDef) and stmt.name == 'setUp']
        if len(setups) != 1 or not signature(setups[0]):
            continue
        setup = setups[0]
        scope = LocalScope(module, setup)
        for call, arguments, prior in registry_constructor_calls(scope, setup, item['engineImport']):
            value = arguments.get(item['parameter'])
            if not isinstance(value, ast.Name) or list(references([call], value.id)) != [value]:
                continue
            read = acceptance_registry_read(scope, value, prior)
            if not read:
                continue
            yield dict(engineName=item['engineName'], testClass=test_class.name, testMethod=setup.name,
                       testMethodLine=setup.lineno, importLine=module.imports[call.func.id][1].lineno,
                       line=call.lineno, parameter=item['parameter'], **read,
                       **(dict(kind='python_acceptance_registry_load', loader=loader) if loader
                          else dict(reason='unverified_registry_loader')))


def main():
    bindings, failures = [], []
    mode = tuple(sys.argv[1:])
    extract_audit = {('--audit',): audit_bindings, ('--production',): audit_production_bindings}.get(mode)
    for item in json.load(sys.stdin):
        try:
            tree = ast.parse(item['source'], filename=item['path'])
            module = Bindings(item['path'], tree)
            if mode == ('--consumption',):
                found = registry_consumption_bindings(module, item)
            elif extract_audit:
                found = extract_audit(module, ast.parse(item['recordSource']))
            else:
                found = module.extract()
            bindings.extend(dict(binding, filePath=item['path']) for binding in found)
        except (SyntaxError, ValueError, RecursionError):
            failures.append(item['path'])
    json.dump(dict(bindings=bindings, parseFailures=failures), sys.stdout)


if __name__ == '__main__':
    main()
