#!/usr/bin/env node
/**
 * daily-update.mjs
 *
 * Incremental update orchestrator for understand-anything.
 * Detects changed services and runs the appropriate update pipeline.
 * 支持内置定时调度，无需系统 cron。
 *
 * Modes:
 *   reextract - Deterministic only (no LLM): structure extraction + source index
 *   full      - Full pipeline via CLI skill invocation (claude/codex/cursor)
 *
 * Usage:
 *   # 单次执行
 *   node daily-update.mjs <project_root> [options]
 *   node daily-update.mjs /path/to/project --mode reextract --pull
 *   node daily-update.mjs /path/to/project --mode reextract --force --dry-run
 *   node daily-update.mjs /path/to/project --cli claude --mode full --pull
 *
 *   # 常驻调度（替代 cron）
 *   node daily-update.mjs /path/to/project --schedule "02:00" --pull
 *   node daily-update.mjs /path/to/project --schedule "every4h" --mode reextract --pull
 *
 * Options:
 *   --cli claude|codex|cursor   CLI tool for full mode (default: claude)
 *   --mode full|reextract       Update mode (default: full)
 *   --phases kg,domain,wiki,business  Phases to run in full mode (default: all)
 *   --language zh|en            Output language (default: zh)
 *   --pull                      Git pull before update
 *   --force                     Use all services instead of only changed services; primarily for reextract
 *   --dry-run                   Preview without executing
 *   --schedule "HH:MM"|"everyNh" 内置定时：每天指定时间 或 每 N 小时执行
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 脚本所在目录向上一级即为插件根目录，reextract 等脚本位于 skills/understand/ 下
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '..');
const SKILL_DIR = resolve(PLUGIN_ROOT, 'skills/understand');

// 第一个非 -- 开头的参数作为项目根目录
const args = process.argv.slice(2);
const projectRoot = args.find(a => !a.startsWith('--'));

if (!projectRoot) {
  console.error('Usage: node daily-update.mjs <project_root> [options]');
  process.exit(1);
}

const PROJECT_ROOT = resolve(projectRoot);

/** 解析 --name value 格式的命令行参数 */
function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultVal;
}

const CLI_TOOL = getFlag('cli', 'claude');
const MODE = getFlag('mode', 'full');         // full = 含 LLM 的完整流程; reextract = 仅确定性提取
const LANGUAGE = getFlag('language', 'zh');
const PHASES = getFlag('phases', 'all');       // 逗号分隔: kg,domain,wiki,business
const DO_PULL = args.includes('--pull');
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const SCHEDULE = getFlag('schedule', '');      // "02:00" 或 "*/4h"

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_DIR = join(PROJECT_ROOT, 'logs', 'understand-updates');
mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, `${timestamp}.log`);

function log(msg) {
  const line = `[${new Date().toISOString().slice(0, 19)}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function shouldRunPhase(phase) {
  return PHASES === 'all' || PHASES.split(',').includes(phase);
}

/** system.json 是 understand-anything 的项目配置入口，包含所有 facet 和 service 定义 */
function readSystemJson() {
  const systemPath = join(PROJECT_ROOT, '.understand-anything/system.json');
  if (!existsSync(systemPath)) {
    log(`ERROR: system.json not found at ${systemPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(systemPath, 'utf-8'));
}

/** 从 system.json 的 facets[].services[] 中提取所有服务的相对路径 */
function getServicePaths(system) {
  const paths = [];
  for (const facet of system.facets || []) {
    for (const svc of facet.services || []) {
      if (svc.path) paths.push(svc.path);
    }
  }
  return paths;
}

/** 检测目录是否为 git 仓库 */
function isGitRepo(dir) {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

const ROOT_IS_GIT = isGitRepo(PROJECT_ROOT);

/**
 * 通过 git diff 检测哪些服务自上次分析以来有代码变更。
 * 对比依据：每个服务的 meta.json 中记录的 gitCommitHash 与当前 HEAD。
 * 无 meta.json、无 hash、或 diff 失败的服务均视为"有变更"，确保不遗漏。
 *
 * 支持两种项目结构：
 *   1. 根目录是 git 仓库（monorepo）→ 从根目录执行 git diff
 *   2. 根目录非 git 仓库，每个服务是独立仓库 → 在服务目录内执行 git diff
 */
function getChangedServices(servicePaths) {
  const changed = [];

  for (const svcPath of servicePaths) {
    const fullPath = join(PROJECT_ROOT, svcPath);
    const metaPath = join(fullPath, '.understand-anything/meta.json');

    // 从未分析过 → 需要全量
    if (!existsSync(metaPath)) {
      changed.push(svcPath);
      continue;
    }

    let lastHash;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      lastHash = (MODE === 'reextract')
        ? (meta.reextractCommitHash || meta.gitCommitHash)
        : meta.gitCommitHash;
    } catch {
      changed.push(svcPath);
      continue;
    }

    if (!lastHash) {
      changed.push(svcPath);
      continue;
    }

    try {
      let diff;
      if (ROOT_IS_GIT) {
        diff = execSync(
          `git diff --name-only ${lastHash}..HEAD -- ${svcPath}/`,
          { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
      } else {
        diff = execSync(
          `git diff --name-only ${lastHash}..HEAD`,
          { cwd: fullPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
      }

      if (diff.length > 0) {
        changed.push(svcPath);
      }
    } catch {
      changed.push(svcPath);
    }
  }
  return changed;
}

/**
 * 拉取最新代码。使用 --ff-only 避免自动 merge 产生冲突。
 *
 * 支持两种项目结构：
 *   1. 根目录是 git 仓库 → 在根目录执行 git pull（含 submodule）
 *   2. 根目录非 git 仓库 → 逐个服务目录执行 git pull
 */
function gitPull(servicePaths) {
  log('Pulling latest code...');

  if (ROOT_IS_GIT) {
    try {
      const out = execSync('git pull --ff-only', {
        cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      log(out.trim());
    } catch (e) {
      log(`WARNING: git pull failed: ${e.message}`);
    }

    if (existsSync(join(PROJECT_ROOT, '.gitmodules'))) {
      try {
        execSync('git submodule update --remote --merge', {
          cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch { /* 子模块更新失败不阻断主流程 */ }
    }
  } else {
    let pulled = 0, failed = 0, skippedNonGit = 0;
    for (const svcPath of servicePaths) {
      const fullPath = join(PROJECT_ROOT, svcPath);
      if (!isGitRepo(fullPath)) {
        skippedNonGit++;
        continue;
      }
      try {
        const out = execSync('git pull --ff-only', {
          cwd: fullPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        pulled++;
        if (!out.includes('Already up to date')) {
          log(`  ${svcPath}: ${out.split('\n').pop()}`);
        }
      } catch (e) {
        failed++;
        log(`  WARNING: ${svcPath}: git pull failed (${e.message.split('\n')[0]})`);
      }
    }
    log(`Pull complete: ${pulled} ok, ${failed} failed, ${skippedNonGit} non-git skipped`);
  }
}


/**
 * reextract 成功后更新 meta.json 的 reextractCommitHash，
 * 避免后续 reextract 运行重复检测已处理的服务。
 *
 * 使用独立字段 `reextractCommitHash` 而非 `gitCommitHash`，
 * 确保不影响 understand skill 的 KG 增量更新判断逻辑
 * （understand skill Phase 0 使用 gitCommitHash 判断 KG 是否需要更新）。
 */
function updateMetaCommitHash(svcPath) {
  const fullPath = join(PROJECT_ROOT, svcPath);
  const metaPath = join(fullPath, '.understand-anything/meta.json');
  const gitDir = ROOT_IS_GIT ? PROJECT_ROOT : fullPath;

  let currentHash;
  try {
    currentHash = execSync('git rev-parse HEAD', {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    log(`  WARNING: cannot get HEAD for ${svcPath}, meta.json not updated`);
    return;
  }

  let meta = {};
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch { /* 损坏的 meta.json → 重建 */ }
  }

  meta.reextractCommitHash = currentHash;
  meta.reextractAt = new Date().toISOString();
  if (!meta.version) meta.version = '1.0.0';

  mkdirSync(dirname(metaPath), { recursive: true });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  log(`  meta.json updated (reextractHash: ${currentHash.slice(0, 12)})`);
}

/**
 * 通过 AI CLI 调用 understand-anything skill。
 * Skill 命令格式如 "/understand backend/ultron-room --language zh"，
 * 各 CLI 均支持在 prompt 中使用 /skill-name 语法触发技能。
 *
 * 自动化关键：每种 CLI 都配置为全自动模式，无需人工确认：
 *   claude → --permission-mode acceptEdits 自动批准文件编辑
 *            --allowedTools "Bash(*)" 自动批准所有 shell 命令
 *   codex  → --full-auto 全自动模式（无需审批）
 *            --sandbox workspace-write 允许文件写入
 *   cursor → --force (--yolo) 跳过所有确认
 *            --approve-mcp 自动批准 MCP 服务器
 *            --trust 信任工作区（跳过首次提示）
 */
function runSkill(skillCmd) {
  if (DRY_RUN) {
    log(`[DRY-RUN] ${skillCmd}`);
    return true;
  }

  log(`Skill: ${skillCmd}`);

  let cmd;
  switch (CLI_TOOL) {
    case 'claude':
      // acceptEdits: 自动批准文件读写; Bash(*): 自动批准所有 shell 命令（含子进程）
      cmd = [
        'claude', '-p', `"${skillCmd}"`,
        '--permission-mode', 'acceptEdits',
        '--allowedTools', '"Bash(*)","Read","Write","Edit","Task","MultiTool"',
        '--output-format', 'text',
      ].join(' ');
      break;
    case 'codex':
      // full-auto: 无需任何审批; workspace-write: 允许文件系统写入
      cmd = [
        'codex', 'exec',
        '--full-auto',
        '--sandbox', 'workspace-write',
        `"${skillCmd}"`,
      ].join(' ');
      break;
    case 'cursor':
      // --force: 自动批准所有文件操作; --approve-mcp: 自动批准 MCP; --trust: 信任工作区
      cmd = [
        'agent', '-p',
        '--force',
        '--approve-mcp',
        '--trust',
        '--output-format', 'text',
        `"${skillCmd}"`,
      ].join(' ');
      break;
    default:
      log(`ERROR: Unknown CLI: ${CLI_TOOL}`);
      return false;
  }

  try {
    execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
    return true;
  } catch (e) {
    log(`ERROR: skill failed: ${e.message}`);
    return false;
  }
}

// ─── 服务级文件锁：防止同一服务被并发处理 ───
// 每个服务各自一个锁文件，放在 <service>/.understand-anything/update.lock。
// 这样 reextract(服务A) 和 full(服务B) 可以并行，
// 但 reextract(服务A) 和 full(服务A) 互斥。

const LOCK_STALE_MS = 6 * 3600 * 1000; // 锁超过 6 小时视为过期（进程已挂）
const heldLocks = new Set();            // 当前进程持有的所有锁路径，退出时批量清理

/** 获取服务级锁文件路径 */
function lockPath(svcPath) {
  return join(PROJECT_ROOT, svcPath, '.understand-anything', 'update.lock');
}

/**
 * 尝试获取指定服务的锁。
 * 返回 true 表示成功获取，false 表示该服务正在被其他进程处理。
 */
function acquireServiceLock(svcPath) {
  const lf = lockPath(svcPath);

  if (existsSync(lf)) {
    try {
      const lock = JSON.parse(readFileSync(lf, 'utf-8'));
      const age = Date.now() - lock.startedAt;

      let alive = false;
      try { process.kill(lock.pid, 0); alive = true; } catch { /* 进程不存在 */ }

      if (alive && age < LOCK_STALE_MS) {
        log(`SKIP ${svcPath}: locked by PID ${lock.pid} (${lock.mode}, ${Math.round(age / 60000)}m ago)`);
        return false;
      }

      log(`Removing stale lock for ${svcPath} (PID ${lock.pid}, age ${Math.round(age / 60000)}m)`);
    } catch {
      log(`Removing corrupted lock for ${svcPath}`);
    }
    unlinkSync(lf);
  }

  mkdirSync(dirname(lf), { recursive: true });
  writeFileSync(lf, JSON.stringify({
    pid: process.pid,
    mode: MODE,
    startedAt: Date.now(),
    startedAtISO: new Date().toISOString(),
  }));
  heldLocks.add(lf);
  return true;
}

function releaseServiceLock(svcPath) {
  const lf = lockPath(svcPath);
  try {
    if (existsSync(lf)) {
      const lock = JSON.parse(readFileSync(lf, 'utf-8'));
      if (lock.pid === process.pid) {
        unlinkSync(lf);
        heldLocks.delete(lf);
      }
    }
  } catch { /* 清理失败不阻断 */ }
}

/** 批量释放当前进程持有的所有锁 */
function releaseAllLocks() {
  for (const lf of heldLocks) {
    try {
      if (existsSync(lf)) {
        const lock = JSON.parse(readFileSync(lf, 'utf-8'));
        if (lock.pid === process.pid) unlinkSync(lf);
      }
    } catch { /* ignore */ }
  }
  heldLocks.clear();
}

// 异常退出时释放所有锁
process.on('SIGINT', () => { releaseAllLocks(); process.exit(0); });
process.on('SIGTERM', () => { releaseAllLocks(); process.exit(0); });
process.on('uncaughtException', (err) => { log(`FATAL: ${err.message}`); releaseAllLocks(); process.exit(1); });

// ─── 核心执行逻辑（单次运行） ───

async function runOnce() {
  log('=========================================');
  log('Understand-Anything Daily Update');
  log('=========================================');
  log(`Project:  ${PROJECT_ROOT}`);
  log(`Mode:     ${MODE}`);
  log(`CLI:      ${CLI_TOOL}`);
  log(`Language: ${LANGUAGE}`);
  log(`Pull:     ${DO_PULL}`);
  log(`Force:    ${FORCE}`);

  const totalStart = Date.now();
  const failures = [];
  let skipped = 0;

  const system = readSystemJson();
  const allServices = getServicePaths(system);
  log(`Services: ${allServices.length} total`);
  if (!ROOT_IS_GIT) {
    log('Note: root is not a git repo, using per-service git operations');
  }

  if (DO_PULL) gitPull(allServices);

  const changed = FORCE ? allServices : getChangedServices(allServices);
  if (FORCE) {
    if (MODE === 'reextract') {
      log('Force mode: reextract target set to all services.');
    } else {
      log('Force mode: target set to all services.');
    }
  }
  if (!FORCE && changed.length === 0) {
    log('No services have code changes since last analysis.');
    if (MODE === 'reextract') {
      log('Nothing to reextract. Done.');
      return 0;
    }
  } else {
    log(`Changed:  ${changed.join(', ')}`);
  }

  // ─── reextract 模式 ───
  if (MODE === 'reextract') {
    log('');
    log('=== Reextract Mode (deterministic, no LLM) ===');

    const reextractScript = join(SKILL_DIR, 'reextract-structure.mjs');
    const sourceIndexScript = join(SKILL_DIR, 'build-source-index.mjs');

    if (!existsSync(reextractScript)) {
      log(`ERROR: reextract-structure.mjs not found at ${reextractScript}`);
      return 1;
    }

    let success = 0, failed = 0;

    for (const svcPath of changed) {
      if (!acquireServiceLock(svcPath)) { skipped++; continue; }

      try {
        log(`--- Reextract: ${svcPath} ---`);
        if (DRY_RUN) {
          log(`[DRY-RUN] node ${reextractScript} ${join(PROJECT_ROOT, svcPath)}`);
          success++;
          continue;
        }

        const start = Date.now();
        const fullPath = join(PROJECT_ROOT, svcPath);
        const result = spawnSync('node', [reextractScript, fullPath], {
          stdio: 'inherit', cwd: PROJECT_ROOT
        });

        if (result.status === 0) {
          success++;
          log(`Structure extracted (${Math.round((Date.now() - start) / 1000)}s)`);
          if (existsSync(sourceIndexScript)) {
            const idxResult = spawnSync('node', [sourceIndexScript, fullPath], {
              stdio: 'inherit', cwd: PROJECT_ROOT
            });
            if (idxResult.status !== 0) {
              log(`WARNING: source index build failed for ${svcPath} (non-critical)`);
            }
          }
          updateMetaCommitHash(svcPath);
        } else {
          failed++;
          log(`WARNING: reextract failed for ${svcPath}`);
        }
      } finally {
        releaseServiceLock(svcPath);
      }
    }

    const elapsed = Math.round((Date.now() - totalStart) / 1000);
    log('');
    log(`Reextract complete (${elapsed}s): ${success} ok, ${failed} failed, ${skipped} skipped (locked)`);
    return failed > 0 ? 1 : 0;
  }

  // ─── full 模式：逐服务加锁处理 KG + Domain ───

  for (const svcPath of changed) {
    if (!acquireServiceLock(svcPath)) { skipped++; continue; }

    try {
      if (shouldRunPhase('kg')) {
        log('');
        log(`=== KG: ${svcPath} ===`);
        if (!runSkill(`/understand ${svcPath} --language ${LANGUAGE}`)) {
          failures.push(`kg:${svcPath}`);
        }
      }

      if (shouldRunPhase('domain')) {
        log('');
        log(`=== Domain: ${svcPath} ===`);
        if (!runSkill(`/understand-domain ${svcPath}`)) {
          failures.push(`domain:${svcPath}`);
        }
      }
    } finally {
      releaseServiceLock(svcPath);
    }
  }

  // Wiki 和 Business 是项目级操作，不需要服务锁
  if (shouldRunPhase('wiki')) {
    log('');
    log('=== Wiki (batch) ===');
    if (!runSkill(`/understand-wiki --batch --language ${LANGUAGE}`)) {
      failures.push('wiki');
    }
  }

  if (shouldRunPhase('business')) {
    log('');
    log('=== Business ===');
    if (!runSkill(`/understand-business --language ${LANGUAGE}`)) {
      failures.push('business');
    }
  }

  const totalElapsed = Math.round((Date.now() - totalStart) / 1000);
  log('');
  log(`Complete (${totalElapsed}s): ${failures.length} failed, ${skipped} skipped (locked)`);

  if (failures.length > 0) {
    log(`FAILURES: ${failures.join(', ')}`);
    return 1;
  }

  log('Status: ALL OK');
  return 0;
}

// ─── 内置调度器 ───

/**
 * 解析 --schedule 参数，支持两种格式：
 *   "HH:MM"  — 每天在指定时间执行（如 "02:00" 表示凌晨 2 点）
 *   "everyNh" — 每 N 小时执行一次（如 "every4h" 表示每 4 小时）
 *
 * 返回 { type: 'daily' | 'interval', hours?, minutes?, intervalMs? }
 */
function parseSchedule(expr) {
  // 每 N 小时格式: every4h, every6h, every12h
  const intervalMatch = expr.match(/^every(\d+)h$/);
  if (intervalMatch) {
    const hours = parseInt(intervalMatch[1], 10);
    return { type: 'interval', intervalMs: hours * 3600 * 1000 };
  }

  // 每天定时格式: HH:MM
  const timeMatch = expr.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    return {
      type: 'daily',
      hours: parseInt(timeMatch[1], 10),
      minutes: parseInt(timeMatch[2], 10),
    };
  }

  return null;
}

/** 计算距离下一个 HH:MM 触发点的毫秒数 */
function msUntilNextDailyRun(hours, minutes) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  // 如果今天的目标时间已过，顺延到明天
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function formatMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

async function startScheduler(schedule) {
  log(`Scheduler started: ${SCHEDULE}`);
  log('Press Ctrl+C to stop.');

  // 首次执行
  log('');
  log('--- Running initial update ---');
  await runOnce();

  if (schedule.type === 'interval') {
    log(`Next run in ${formatMs(schedule.intervalMs)}`);

    setInterval(async () => {
      log('');
      log(`--- Scheduled run (every ${SCHEDULE}) ---`);
      await runOnce();
      log(`Next run in ${formatMs(schedule.intervalMs)}`);
    }, schedule.intervalMs);

  } else if (schedule.type === 'daily') {
    const scheduleNextDaily = () => {
      const ms = msUntilNextDailyRun(schedule.hours, schedule.minutes);
      log(`Next run at ${String(schedule.hours).padStart(2, '0')}:${String(schedule.minutes).padStart(2, '0')} (in ${formatMs(ms)})`);

      setTimeout(async () => {
        log('');
        log(`--- Scheduled run (daily at ${SCHEDULE}) ---`);
        await runOnce();
        scheduleNextDaily();
      }, ms);
    };
    scheduleNextDaily();
  }
}

// ─── 入口 ───

if (SCHEDULE) {
  const schedule = parseSchedule(SCHEDULE);
  if (!schedule) {
    console.error(`Invalid schedule format: "${SCHEDULE}". Use "HH:MM" (e.g. "02:00") or "everyNh" (e.g. "every4h").`);
    process.exit(1);
  }
  startScheduler(schedule);
} else {
  // 单次执行模式
  const exitCode = await runOnce();
  process.exit(exitCode);
}
