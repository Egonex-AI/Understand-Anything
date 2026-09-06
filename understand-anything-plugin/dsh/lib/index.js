/**
 * @understand-anything/dsh — DeepSeek Harness (DSH) bundle for Understand Anything.
 *
 * Registers the bundled /understand skill set into a DSH profile. Skills are
 * shipped in this package's `skills/` directory (synced from the parent plugin's
 * `../skills/` at build time) so each skill's scripts resolve the core through
 * this bundle's `packages/core/` and shipped grammar packages.
 *
 * @module @understand-anything/dsh
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Plugin id used by the cordis patch row. */
export const name = '@understand-anything/dsh';

/** Services this plugin needs at apply time. */
export const inject = ['skills'];

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path of this bundle's root. */
const BUNDLE_ROOT = join(__dirname, '..');

/** Absolute path of the bundled skills directory (this package's `skills/`). */
const SKILLS_DIR = join(BUNDLE_ROOT, 'skills');

/** Grammar packages shipped under `vendor/grammars/` that must be resolvable. */
const SHIPPED_GRAMMAR_PACKAGES = [
  'tree-sitter-c',
  'tree-sitter-cpp',
  'tree-sitter-c-sharp',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-javascript',
  'tree-sitter-php',
  'tree-sitter-python',
  'tree-sitter-ruby',
  'tree-sitter-rust',
  'tree-sitter-scala',
  'tree-sitter-typescript',
  '@tree-sitter-grammars/tree-sitter-kotlin',
  '@understand-anything/tree-sitter-dart-wasm',
  '@understand-anything/tree-sitter-swift-wasm',
];

/**
 * Link each shipped grammar package from `vendor/grammars/<pkg>` into this
 * bundle's `node_modules/` so the core's `require.resolve('<pkg>/<file>.wasm')`
 * resolves. npm strips `node_modules/` from packed tarballs, so the grammars
 * ship under `vendor/grammars/` and are linked lazily on profile boot.
 */
function linkGrammarPackages(ctx) {
  const grammarsDir = join(BUNDLE_ROOT, 'vendor', 'grammars');
  if (!existsSync(grammarsDir)) return;
  for (const pkgName of SHIPPED_GRAMMAR_PACKAGES) {
    const src = join(grammarsDir, ...pkgName.split('/'));
    if (!existsSync(src)) continue;
    const dest = join(BUNDLE_ROOT, 'node_modules', ...pkgName.split('/'));
    if (existsSync(dest)) continue;
    try {
      mkdirSync(dirname(dest), { recursive: true });
      if (process.platform !== 'win32') {
        symlinkSync(src, dest, 'dir');
      } else {
        rmSync(dest, { recursive: true, force: true });
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    } catch (error) {
      ctx?.logger?.error?.('@understand-anything/dsh failed to link grammar %s: %s', pkgName, String(error));
    }
  }
}

/**
 * Parse the leading `---` frontmatter block of a SKILL.md file.
 * Returns `{ frontmatter, content }` where `content` is the markdown body after
 * the closing `---`. A file without frontmatter yields `{}` and the whole body.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, content: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, content: text };
  const raw = text.slice(3, end);
  const content = text.slice(end + 4).replace(/^\n/, '');
  const frontmatter = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) frontmatter[m[1]] = m[2].trim();
  }
  return { frontmatter, content };
}

/** List the bundled skill bundle directories (`<skills>/<name>/SKILL.md`). */
function listBundledSkills() {
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((skillName) => statSync(join(SKILLS_DIR, skillName, 'SKILL.md'), { throwIfNoEntry: false }));
}

/** Build a SkillRegistration for one bundled skill, reading its SKILL.md. */
function buildSkill(skillName) {
  const skillDir = join(SKILLS_DIR, skillName);
  const text = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const { frontmatter, content } = parseFrontmatter(text);
  const registration = {
    name: skillName,
    description: frontmatter.description || `Understand Anything skill: ${skillName}`,
    source: 'bundled',
    resourceBase: {
      kind: 'directory',
      path: skillDir,
    },
    content,
  };
  if (frontmatter.whenToUse) registration.whenToUse = frontmatter.whenToUse;
  return registration;
}

/**
 * Plugin entry: register every bundled /understand skill.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the cordis context.
 * @param {object} [_config] - plugin config from the patch row.
 * @returns {() => void} disposer that unregisters every skill.
 */
export async function apply(ctx, _config = {}) {
  linkGrammarPackages(ctx);

  const disposers = [];
  for (const skillName of listBundledSkills()) {
    try {
      const skill = buildSkill(skillName);
      disposers.push(ctx.skills.register(skill));
      ctx.logger?.info('@understand-anything/dsh registered skill %s', skillName);
    } catch (error) {
      ctx.logger?.error('@understand-anything/dsh failed to register skill %s: %s', skillName, String(error));
    }
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}