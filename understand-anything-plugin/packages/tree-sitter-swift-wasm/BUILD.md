# tree-sitter-swift WASM (vendored)

This directory ships a pre-built `tree-sitter-swift.wasm` because the published
`tree-sitter-swift@0.7.1` npm package ships native `.node` prebuilds and C
sources, but no WASM artifact.

## Why vendored

The core analyzer loads grammars through `web-tree-sitter@0.26.x`, which expects
modern `dylink.0` WASM modules. Vendoring the Swift grammar keeps runtime
loading consistent with the Dart grammar package in this workspace and avoids a
runtime dependency on a third-party bundle of many unrelated grammars.

## How to rebuild

```bash
git clone https://github.com/alex-pinkus/tree-sitter-swift.git /tmp/tree-sitter-swift
cd /tmp/tree-sitter-swift
git checkout d42e9bb24646c4dbf1f5ec476a35b96d817da448
npx -y tree-sitter-cli@0.26.9 build --wasm --output tree-sitter-swift.wasm .
cp tree-sitter-swift.wasm \
   /path/to/understand-anything-plugin/packages/tree-sitter-swift-wasm/
```

Verify the resulting wasm:

```bash
node -e "const b=require('fs').readFileSync('tree-sitter-swift.wasm'); console.log(b.toString('latin1').includes('dylink.0'))"
# Expect: true
```

## Provenance

- Grammar source: `alex-pinkus/tree-sitter-swift` at commit
  `d42e9bb24646c4dbf1f5ec476a35b96d817da448`, recorded in
  `.swift-grammar-pin`.
- Current artifact source: extracted from
  `@plurnk/plurnk-mimetypes-text-swift@0.2.3`, which vendors a compatible
  `tree-sitter-swift.wasm` for this grammar revision.
- The checked-in artifact was verified to load with this repository's
  `web-tree-sitter@0.26.x` runtime and to contain the `dylink.0` custom section.
- License: MIT, inherited from `tree-sitter-swift`.

## When to remove this package

If `tree-sitter-swift` publishes a refreshed npm package with a compatible
`tree-sitter-swift.wasm`, this workspace package can be deleted and
`@understand-anything/core` can depend directly on the upstream grammar package.
