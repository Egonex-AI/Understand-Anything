import { describe, expect, it } from 'vitest';

import { parseTsConfigText } from '../../skills/understand/extract-import-map.mjs';

describe('parseTsConfigText', () => {
  it('keeps path aliases when glob strings contain comment-looking tokens', () => {
    const parsed = parseTsConfigText(`{
      "include": ["**/*.ts", "**/*.tsx"],
      "compilerOptions": {
        "paths": { "#/*": ["./src/*"] },
        /* block comment */
      }
    }`);

    expect(parsed?.paths.get('#/*')).toEqual(['./src/*']);
  });
});
