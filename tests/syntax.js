const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('<script>');
const end = html.lastIndexOf('</script>');
assert(start !== -1 && end !== -1, 'Inline script not found');
const script = html.slice(start + '<script>'.length, end);
const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const COLORS_RE = /color: '#(?:cba6f7|f5c2e7|a6e3a1|f9e2af|89b4fa|f38ba8|94e2d5|fab387)'/;

const tmp = path.join(__dirname, '.inline-script.check.js');
fs.writeFileSync(tmp, script);
const result = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
fs.rmSync(tmp, { force: true });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Syntax check failed\n');
  process.exit(result.status || 1);
}

// Runtime declarations and load ordering.
assert(script.indexOf('const uid =') < script.indexOf('const savedData = load();'), 'uid is declared after load() uses it');
assert(script.indexOf('const safeColor =') < script.indexOf('const savedData = load();'), 'safeColor is declared after load() uses it');
assert(script.indexOf('function load() {') < script.indexOf('const savedData = load();'), 'load() is called before it is initialized');
assert(script.includes("replaceAll('\"', '&quot;')") && script.includes("replaceAll(\"'\", '&#39;')"), 'esc() must escape quotes used in attributes');

// Regression: the responsive hamburger was visible on desktop.
const mobileCss = style.slice(0, style.indexOf('@media (max-width: 640px)'));
assert(/\.mobile-toggle\s*\{[^}]*display\s*:\s*none/s.test(mobileCss), 'mobile sidebar toggle must be hidden outside the mobile breakpoint');
assert(script.includes('isMobileViewport.addEventListener'), 'mobile viewport changes should be observed');
assert(script.includes('setMobileSidebar(false)'), 'mobile sidebar should initialize closed');

// Anthropic text completion must not reference the vision attachment, and vision must receive it.
const anthropicBlock = script.slice(script.indexOf('anthropic: {'), script.indexOf('openrouter: {'));
const anthropicBuild = anthropicBlock.slice(anthropicBlock.indexOf('build(prompt'), anthropicBlock.indexOf('buildVision'));
assert(!anthropicBuild.includes('attachment'), 'Anthropic text build must not reference the vision attachment');
assert(/buildVision\(prompt, key, model, attachment\)[\s\S]*attachment\./.test(anthropicBlock), 'Anthropic buildVision must receive the attachment parameter');

// Regression: stale AI distractors after editing cards with the same id.
assert(!script.includes('${card.id}|${side}') && !script.includes(`${'${card.id}'}|${'${side}'}`), 'AI distractor cache must include card content');

// Unique static IDs and referenced control targets.
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual(duplicates, [], `duplicate static IDs: ${[...new Set(duplicates)].join(', ')}`);
for (const id of ['cardSearch', 'exportBackupBtn', 'importBackupBtn', 'backupFile', 'studyModal', 'deckModal', 'cardModal', 'deckActionsModal']) {
  assert(ids.includes(id), `missing required element: #${id}`);
}
for (const match of html.matchAll(/data-close="([^"]+)"/g)) {
  assert(ids.includes(match[1]), `data-close references missing #${match[1]}`);
}

// Sidebar deck rows should expose one action menu, not four space-consuming inline controls.
const buildDeckItem = script.slice(script.indexOf('function buildDeckItem(deck)'), script.indexOf('function buildFolderRow(folder)'));
assert((buildDeckItem.match(/data-actions-deck=/g) || []).length === 1, 'deck rows should have exactly one actions-menu trigger');
for (const legacyControl of ['data-export-deck', 'data-move-deck', 'data-edit-deck', 'data-del-deck']) {
  assert(!buildDeckItem.includes(legacyControl), `sidebar should not inline ${legacyControl}`);
}

// FSRS is a per-deck preference with normalized card schedules and four ratings.
assert(script.includes('fsrs: !!d.fsrs'), 'deck FSRS preference must be normalized');
assert(script.includes('schedule: normalizeFsrsState(c.schedule)'), 'card schedules must be normalized');
assert(script.includes('const FSRS_WEIGHTS = Object.freeze('), 'FSRS weights must be explicit');
assert(script.includes('function fsrsSchedule('), 'FSRS scheduler must be present');
assert(html.includes('id="deckFsrsToggle"'), 'deck modal must expose FSRS toggle');
assert(script.includes("document.getElementById('deckFsrsToggle')"), 'deck modal must initialize and save FSRS toggle');
assert(script.includes('data-rating="1"') && script.includes('data-rating="4"'), 'FSRS flashcards must offer all four ratings');
assert(script.includes("card.schedule = fsrsSchedule(card, rating)"), 'FSRS answers must persist the card schedule');
assert(script.includes("fsrsCounts(deck, pool)"), 'overview and modal must show due/new counts');
assert(script.includes("isFsrsActive(deck, mode) ? pool.filter(c => isCardDue(c)) : pool"), 'FSRS eligibility must be due-aware and quiz-excluded');
assert(script.includes("session.deck.fsrs && session.mode !== 'quiz'") || script.includes('isFsrsActive(session.deck, session.mode)'), 'quiz answers must not update FSRS schedules');
assert(script.includes("function normalizeFsrsState"), 'malformed schedules must be normalized');

// Study options and folder collapse state are remembered across reloads.
assert(script.includes("localStorage.setItem('flash-study-options-v1'"), 'study options must be persisted');
assert(script.includes("localStorage.getItem('flash-study-options-v1'"), 'study options must be restored');
assert(script.includes("persistOptions();"), 'study option changes must be saved');
assert(script.includes("localStorage.setItem('flash-collapsed-folders-v1'"), 'folder collapse state must be persisted');
assert(script.includes("localStorage.getItem('flash-collapsed-folders-v1'"), 'folder collapse state must be restored');

// The study dialog has a discoverable cancel affordance.
assert((html.match(/data-close="studyModal"/g) || []).length === 2, 'both study modal steps need a cancel action');

// Sample deck colors must remain valid after normalizeLibrary applies safeColor().
const sampleBlock = script.slice(script.indexOf('const SAMPLE ='), script.indexOf('const uid ='));
for (const color of sampleBlock.match(/color: '(#(?:[0-9a-f]{6}))'/g) || []) {
  assert(COLORS_RE.test(color), `sample color is not in the app palette: ${color}`);
}

// Modal Escape cannot accidentally abandon a study session, and navigating away preserves partial answers.
assert(script.includes('e.stopImmediatePropagation(); // close the modal without also leaving study mode'), 'Escape must prioritize modal dismissal');
assert(script.includes('function endActiveSession()'), 'active sessions must be ended when navigating');
assert(script.includes('endActiveSession();\n    state.activeDeckId = deck.id;'), 'changing decks must save partial progress');
assert(script.includes('endActiveSession();\n  if (isMobileViewport.matches) setMobileSidebar(false);'), 'returning home must save partial progress');

// Card deletion is reversible through the toast action.
assert(script.includes("Card deleted from"), 'card deletion should tell the user what happened');
assert(script.includes("label: 'Undo'"), 'card deletion should offer undo');
assert(style.includes('.toast-action'), 'undo action must be styled with the app controls');
assert(style.includes('.import-drop.dragover'), 'drag-over import state must be styled');
assert(script.includes("loadImportTextFile(file)"), 'text imports should accept dropped files');
assert(script.includes("setImportFile(file)"), 'AI imports should accept dropped files');

// Backup must never accidentally include provider keys.
const backupBlock = script.slice(script.indexOf('function exportBackup()'), script.indexOf('document.getElementById(\'exportBackupBtn\')'));
assert(backupBlock.includes('folders') && backupBlock.includes('decks'), 'backup should include library data');
assert(!backupBlock.includes('aiCfg'), 'backup export must not include API keys or AI settings');

console.log('Inline script syntax: OK');
console.log('Structure, regression, safety, and ID checks: OK');
