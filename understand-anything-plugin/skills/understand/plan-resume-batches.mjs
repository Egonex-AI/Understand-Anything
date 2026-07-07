#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function fail(message) {
  console.error(`Error: plan-resume-batches: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    fail(`failed to read ${path}: ${error.message}`);
  }
}

function isValidBatchOutput(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(data.nodes) && Array.isArray(data.edges);
  } catch {
    return false;
  }
}

const projectRoot = process.argv[2];
if (!projectRoot) {
  fail('usage: node plan-resume-batches.mjs <project-root>');
}

const intermediateDir = join(projectRoot, '.understand-anything', 'intermediate');
const batchesPath = join(intermediateDir, 'batches.json');

if (!existsSync(batchesPath)) {
  fail(`missing ${batchesPath}`);
}

const batchesDoc = readJson(batchesPath);
const batches = Array.isArray(batchesDoc.batches) ? batchesDoc.batches : [];
const batchIndexes = batches.map((batch, position) =>
  Number.isInteger(batch.batchIndex) ? batch.batchIndex : position + 1,
);
const knownBatchIndexes = new Set(batchIndexes);
const completed = new Set();
const invalidBatchFiles = [];

if (existsSync(intermediateDir)) {
  for (const name of readdirSync(intermediateDir)) {
    const match = /^batch-(\d+)(?:-part-\d+)?\.json$/.exec(name);
    if (!match) continue;

    const batchIndex = Number.parseInt(match[1], 10);
    if (!knownBatchIndexes.has(batchIndex)) continue;

    const path = join(intermediateDir, name);
    if (isValidBatchOutput(path)) {
      completed.add(batchIndex);
    } else {
      invalidBatchFiles.push(name);
    }
  }
}

const completedBatchIndexes = batchIndexes.filter(batchIndex => completed.has(batchIndex));
const pendingBatchIndexes = batchIndexes.filter(batchIndex => !completed.has(batchIndex));

const plan = {
  schemaVersion: 1,
  totalBatches: batchIndexes.length,
  completed: completedBatchIndexes.length,
  pending: pendingBatchIndexes.length,
  completedBatchIndexes,
  pendingBatchIndexes,
  invalidBatchFiles: invalidBatchFiles.sort(),
};

mkdirSync(intermediateDir, { recursive: true });
writeFileSync(join(intermediateDir, 'resume-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify(plan, null, 2));
