#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillDir = dirname(fileURLToPath(import.meta.url));
const aliases = {
  spring: ['spring', 'jpa'],
  springboot: ['spring', 'jpa'],
  jpa: ['jpa'],
  javapersistence: ['jpa'],
  jakartapersistence: ['jpa'],
  javaxpersistence: ['jpa'],
  eclipselink: ['jpa'],
  hibernate: ['jpa'],
};

/** Resolve trusted bundled addendums from scanner framework metadata. */
export function loadFrameworkAddendums(frameworks, directory = skillDir) {
  const ids = new Set();
  for (const framework of Array.isArray(frameworks) ? frameworks : []) {
    if (typeof framework !== 'string') continue;
    const id = framework.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!id) continue;
    for (const name of Object.hasOwn(aliases, id) ? aliases[id] : [id]) ids.add(name);
  }

  const addendums = [];
  for (const id of ids) {
    try {
      addendums.push({
        id,
        content: readFileSync(join(directory, 'frameworks', `${id}.md`), 'utf8'),
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return addendums;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('Usage: node framework-addendums.mjs <scan-result.json>');
    process.exitCode = 1;
  } else {
    const scan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    console.log(loadFrameworkAddendums(scan.frameworks).map(({ content }) => content).join('\n\n'));
  }
}
