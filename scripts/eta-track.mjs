#!/usr/bin/env node
/**
 * eta-track.mjs — ETA calibration tracking system
 *
 * Usage:
 *   node scripts/eta-track.mjs add "Task Name" category estimatedMinutes
 *   node scripts/eta-track.mjs complete taskId
 *   node scripts/eta-track.mjs stats
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TRACKER_PATH = join(__dirname, '..', 'docs', 'eta-tracker.json');

const VALID_CATEGORIES = ['infrastructure', 'dashboard', 'research', 'code', 'content', 'design'];
const MIN_SAMPLES_FOR_CALIBRATION = 5;

function readTracker() {
  try {
    return JSON.parse(readFileSync(TRACKER_PATH, 'utf8'));
  } catch (err) {
    console.error('Failed to read tracker file:', err.message);
    process.exit(1);
  }
}

function writeTracker(data) {
  try {
    writeFileSync(TRACKER_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write tracker file:', err.message);
    process.exit(1);
  }
}

function recalibrate(tracker) {
  const completed = tracker.tasks.filter(t => t.ratio !== null);
  tracker.sampleSize = completed.length;

  if (completed.length < MIN_SAMPLES_FOR_CALIBRATION) {
    tracker.calibrationFactor = null;
    tracker.categoryFactors = {};
    tracker.lastCalibrated = null;
    return;
  }

  // Overall calibration factor: mean of (actual / estimated) ratios
  const overallRatios = completed.filter(t => t.estimatedMinutes !== null);
  if (overallRatios.length >= MIN_SAMPLES_FOR_CALIBRATION) {
    const sum = overallRatios.reduce((acc, t) => acc + t.ratio, 0);
    tracker.calibrationFactor = parseFloat((sum / overallRatios.length).toFixed(4));
  }

  // Per-category factors
  const categories = {};
  for (const task of completed) {
    if (task.estimatedMinutes === null) continue;
    if (!categories[task.category]) categories[task.category] = [];
    categories[task.category].push(task.ratio);
  }

  tracker.categoryFactors = {};
  for (const [cat, ratios] of Object.entries(categories)) {
    if (ratios.length >= 2) {
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      tracker.categoryFactors[cat] = {
        factor: parseFloat(avg.toFixed(4)),
        sampleSize: ratios.length
      };
    }
  }

  tracker.lastCalibrated = new Date().toISOString();
}

function cmdAdd(args) {
  if (args.length < 3) {
    console.error('Usage: node scripts/eta-track.mjs add "Task Name" category estimatedMinutes');
    console.error('  category: ' + VALID_CATEGORIES.join(' | '));
    process.exit(1);
  }

  const [name, category, estimatedStr] = args;
  const estimatedMinutes = parseInt(estimatedStr, 10);

  if (!VALID_CATEGORIES.includes(category)) {
    console.error(`Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  if (isNaN(estimatedMinutes) || estimatedMinutes <= 0) {
    console.error(`Invalid estimatedMinutes "${estimatedStr}". Must be a positive integer.`);
    process.exit(1);
  }

  const tracker = readTracker();
  const nextId = tracker.tasks.length > 0
    ? Math.max(...tracker.tasks.map(t => t.id)) + 1
    : 1;

  const task = {
    id: nextId,
    name,
    category,
    estimatedMinutes,
    startTimestamp: new Date().toISOString(),
    completionTimestamp: null,
    actualMinutes: null,
    ratio: null
  };

  tracker.tasks.push(task);
  writeTracker(tracker);

  console.log(`Added task #${nextId}: "${name}" [${category}] — estimated ${estimatedMinutes}m`);
  console.log(`Started: ${task.startTimestamp}`);
}

function cmdComplete(args) {
  if (args.length < 1) {
    console.error('Usage: node scripts/eta-track.mjs complete taskId');
    process.exit(1);
  }

  const taskId = parseInt(args[0], 10);
  if (isNaN(taskId)) {
    console.error(`Invalid taskId "${args[0]}". Must be a number.`);
    process.exit(1);
  }

  const tracker = readTracker();
  const task = tracker.tasks.find(t => t.id === taskId);

  if (!task) {
    console.error(`Task #${taskId} not found.`);
    process.exit(1);
  }

  if (task.completionTimestamp !== null) {
    console.error(`Task #${taskId} is already completed at ${task.completionTimestamp}`);
    process.exit(1);
  }

  const now = new Date();
  const start = new Date(task.startTimestamp);
  const actualMinutes = parseFloat(((now - start) / 1000 / 60).toFixed(2));

  task.completionTimestamp = now.toISOString();
  task.actualMinutes = actualMinutes;

  if (task.estimatedMinutes !== null) {
    task.ratio = parseFloat((actualMinutes / task.estimatedMinutes).toFixed(4));
  }

  recalibrate(tracker);
  writeTracker(tracker);

  console.log(`Completed task #${taskId}: "${task.name}"`);
  console.log(`  Actual time: ${actualMinutes}m`);
  if (task.estimatedMinutes !== null) {
    console.log(`  Estimated:   ${task.estimatedMinutes}m`);
    console.log(`  Ratio:       ${task.ratio}x (1.0 = perfect, >1 = took longer, <1 = faster)`);
  }
  if (tracker.calibrationFactor !== null) {
    console.log(`\nOverall calibration factor updated: ${tracker.calibrationFactor}x (n=${tracker.sampleSize})`);
  }
}

function cmdStats() {
  const tracker = readTracker();
  const completed = tracker.tasks.filter(t => t.completionTimestamp !== null);
  const inProgress = tracker.tasks.filter(t => t.completionTimestamp === null);

  console.log('=== ETA Calibration Tracker ===\n');

  console.log(`Tasks total:      ${tracker.tasks.length}`);
  console.log(`Completed:        ${completed.length}`);
  console.log(`In progress:      ${inProgress.length}`);
  console.log(`Sample size:      ${tracker.sampleSize}`);
  console.log(`Min for calib:    ${MIN_SAMPLES_FOR_CALIBRATION}`);

  if (tracker.calibrationFactor !== null) {
    console.log(`\nOverall factor:   ${tracker.calibrationFactor}x`);
    console.log(`Last calibrated:  ${tracker.lastCalibrated}`);
    console.log(`\nInterpretation:`);
    if (tracker.calibrationFactor < 0.5) {
      console.log('  Estimates are way too high — actuals running much faster than predicted.');
    } else if (tracker.calibrationFactor < 0.8) {
      console.log('  Estimates are running high — actuals faster than predicted.');
    } else if (tracker.calibrationFactor <= 1.2) {
      console.log('  Estimates are well-calibrated.');
    } else if (tracker.calibrationFactor <= 2.0) {
      console.log('  Estimates are running low — actuals slower than predicted.');
    } else {
      console.log('  Estimates are significantly underestimating actual time.');
    }
  } else {
    console.log(`\nCalibration factor: not yet available (need ${MIN_SAMPLES_FOR_CALIBRATION - tracker.sampleSize} more completed tasks with estimates)`);
  }

  if (Object.keys(tracker.categoryFactors).length > 0) {
    console.log('\nPer-category factors:');
    for (const [cat, data] of Object.entries(tracker.categoryFactors)) {
      console.log(`  ${cat.padEnd(14)} ${data.factor}x  (n=${data.sampleSize})`);
    }
  }

  if (inProgress.length > 0) {
    console.log('\nIn Progress:');
    for (const t of inProgress) {
      const elapsed = parseFloat(((Date.now() - new Date(t.startTimestamp)) / 1000 / 60).toFixed(1));
      const est = t.estimatedMinutes !== null ? `${t.estimatedMinutes}m est` : 'no estimate';
      console.log(`  #${t.id} [${t.category}] "${t.name}" — ${elapsed}m elapsed, ${est}`);
    }
  }

  if (completed.length > 0) {
    console.log('\nCompleted:');
    for (const t of completed) {
      const ratio = t.ratio !== null ? ` (ratio: ${t.ratio}x)` : '';
      console.log(`  #${t.id} [${t.category}] "${t.name}" — ${t.actualMinutes}m actual${ratio}`);
    }
  }
}

// Main
const [,, command, ...rest] = process.argv;

switch (command) {
  case 'add':
    cmdAdd(rest);
    break;
  case 'complete':
    cmdComplete(rest);
    break;
  case 'stats':
    cmdStats();
    break;
  default:
    console.log('ETA Calibration Tracker');
    console.log('');
    console.log('Commands:');
    console.log('  add "Task Name" category estimatedMinutes');
    console.log('  complete taskId');
    console.log('  stats');
    console.log('');
    console.log('Categories: ' + VALID_CATEGORIES.join(', '));
    process.exit(command ? 1 : 0);
}
