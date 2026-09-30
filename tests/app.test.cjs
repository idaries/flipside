'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('<script>') + '<script>'.length;
const end = html.lastIndexOf('</script>');
const source = html.slice(start, end);

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classList = {
      values: new Set(),
      add(...names) { names.forEach(name => this.values.add(name)); },
      remove(...names) { names.forEach(name => this.values.delete(name)); },
      toggle(name, force) {
        const next = force === undefined ? !this.values.has(name) : !!force;
        next ? this.values.add(name) : this.values.delete(name);
        return next;
      },
      contains(name) { return this.values.has(name); },
    };
    this.dataset = {};
    this.style = { setProperty() {} };
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.offsetParent = {};
    thisHandlers(this);
  }
  setAttribute() {}
  getAttribute(name) { return name === 'aria-pressed' ? 'false' : null; }
  removeAttribute() {}
  addEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  closest() { return this; }
  contains() { return false; }
  focus() {}
  blur() {}
  click() {}
  remove() {}
}
function thisHandlers(element) {
  element.getBoundingClientRect = () => ({ top: 0, left: 0, width: 100, height: 100 });
}

function makeContext() {
  const storage = new Map();
  const elements = new Map();
  const documentElement = new FakeElement('html');
  const body = new FakeElement('body');
  const element = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  const context = {
    console,
    Date,
    Math,
    JSON,
    Set,
    Map,
    Number,
    String,
    Array,
    Object,
    Promise,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    AbortController,
    fetch: async () => { throw new Error('network disabled'); },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    confirm: () => true,
    prompt: () => 'Test',
    setTimeout, clearTimeout,
    document: {
      activeElement: body,
      body,
      documentElement,
      createElement: tag => new FakeElement(tag),
      getElementById: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  context.window = context;
  context.document.body = body;
  return vm.createContext(context);
}

function run(code, context) {
  return vm.runInContext(code, context, { filename: 'index.html' });
}

test('application script parses', () => {
  new vm.Script(source, { filename: 'index.html' });
});

test('markup exposes required controls without duplicate static IDs', () => {
  const required = ['newLibraryItemBtn', 'studyBtn', 'cardSearch', 'noteEditorRich', 'settingsModal'];
  for (const id of required) assert.match(html, new RegExp(`id=["']${id}["']`));
  const staticHtml = html.slice(0, start);
  const ids = [...staticHtml.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
});

test('library normalization repairs IDs and dangling folders', () => {
  const context = makeContext();
  run(source, context);
  const result = run(`normalizeLibrary({
    decks: [{ id: '', name: '  Biology  ', cards: [{ front: 'cell', back: 'unit' }] }, null],
    folders: [{ id: 'folder-a', name: 'School' }],
    notes: [{ id: '', title: ' Notes ', content: 'abc' }],
  })`, context);
  assert.equal(result.decks.length, 1);
  assert.equal(result.decks[0].name, 'Biology');
  assert.equal(result.decks[0].cards[0].front, 'cell');
  assert.match(result.decks[0].id, /^deck-0-/);
  assert.match(result.notes[0].id, /^note-0-/);
  assert.equal(result.notes[0].title, 'Notes');
});

test('text import understands Anki, dash, comma, and semicolon formats', () => {
  const context = makeContext();
  run(source, context);
  const anki = '#separator:tab\nfront\tback\n<div>HTML</div>\t<b>answer</b>';
  const tab = run(`parseImportText(${JSON.stringify(anki)}, 'anki', 'tab', 'newline')`, context);
  assert.equal(JSON.stringify(tab), JSON.stringify( [{ front: 'front', back: 'back' }, { front: 'HTML', back: 'answer' }]));
  const dash = run(`parseImportText('term - definition', 'anki', 'dash', 'newline')`, context);
  assert.equal(JSON.stringify(dash), JSON.stringify( [{ front: 'term', back: 'definition' }]));
  const comma = run(`parseImportText('a,b', 'anki', 'comma', 'newline')`, context);
  assert.equal(JSON.stringify(comma), JSON.stringify( [{ front: 'a', back: 'b' }]));
  const semis = run(`parseImportText('a,b;c,d', 'anki', 'comma', 'semicolon')`, context);
  assert.equal(JSON.stringify(semis), JSON.stringify( [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }]));
});

test('markdown is escaped and renders safe links, code, and tables', () => {
  const context = makeContext();
  run(source, context);
  const unsafe = run(`renderMarkdown('# Hello\\n<script>alert(1)</script>\\n[ok](javascript:alert(1))\\n[good](https://example.com)')`, context);
  assert.match(unsafe, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(unsafe, /<script>/);
  assert.match(unsafe, /&lt;script&gt;/);
  assert.doesNotMatch(unsafe, /href="javascript:/);
  assert.match(unsafe, /href="https:\/\/example\.com"/);
  const table = run(`renderMarkdown('| A | B |\\n| --- | --- |\\n| 1 | 2 |')`, context);
  assert.match(table, /<table>/);
  assert.match(table, /<th>A<\/th>/);
  assert.match(table, /<td>2<\/td>/);
});

test('rich tables convert back to valid Markdown', () => {
  const context = makeContext();
  run(source, context);
  const markdown = run(`htmlToMarkdown({
    tagName: 'TABLE', rows: [{ cells: [{ childNodes: [] }, { childNodes: [] }] }]
  })`, context);
  assert.match(markdown, /^\\| \\| \\| \\|$/m);
  assert.match(markdown, /\\|--\\|--\\|/);
});

test('AI distractor parsing and cleanup reject duplicates and malformed output', () => {
  const context = makeContext();
  run(source, context);
  assert.equal(JSON.stringify(run(`cleanDistractors(['B', ' B ', 'C', ''], 'a')`, context)), JSON.stringify(['B', 'C']));
  assert.equal(run(`cleanDistractors(['A', 'a', 'A '], 'a')`, context), null);
  assert.equal(JSON.stringify(run(`parseBatchDistractors('{"1":["x","y","z"],"2":["a","b","c"]}', 2)`, context)),
    JSON.stringify([['x', 'y', 'z'], ['a', 'b', 'c']]));
  assert.equal(JSON.stringify(run(`parseBatchDistractors('["a","b","c","d","e","f"]', 2)`, context)),
    JSON.stringify([['a', 'b', 'c'], ['d', 'e', 'f']]));
  assert.equal(JSON.stringify(run(`parseJsonCards('[{"front":" Q ","back":" A "}]')`, context)), JSON.stringify([{ front: 'Q', back: 'A' }]));
});

test('FSRS schedules new and failed cards within sane bounds', () => {
  const context = makeContext();
  run(source, context);
  const now = 1_800_000_000_000;
  const good = run(`fsrsSchedule({ schedule: null }, 3, ${now})`, context);
  assert.ok(good.due > now);
  assert.equal(good.reps, 1);
  assert.equal(good.lapses, 0);
  const old = { stability: 12, difficulty: 5, due: now - 1, last: now - 20 * 86_400_000, reps: 4, lapses: 0 };
  const failed = run(`fsrsSchedule({ schedule: ${JSON.stringify(old)} }, 1, ${now})`, context);
  assert.ok(failed.due > now);
  assert.ok(failed.due - now <= 15 * 60_000);
  assert.equal(failed.reps, 5);
  assert.equal(failed.lapses, 1);
});

test('study preserves explicitly supplied missed FSRS cards', () => {
  const context = makeContext();
  run(source, context);
  run(`state.options.shuffle = false; state.options.mode = 'flashcards';`, context);
  run(`state.decks = [{ id: 'deck', name: 'Deck', color: COLORS[0], fsrs: true, cards: [
    { id: 'a', front: 'A', back: 'a', starred: false, schedule: null },
    { id: 'b', front: 'B', back: 'b', starred: false, schedule: { stability: 10, difficulty: 5, due: Date.now() + 86_400_000, last: Date.now(), reps: 1, lapses: 0 } }
  ]}]; state.activeDeckId = 'deck';`, context);
  run(`startSession(state.decks[0], state.decks[0].cards, { preserveCards: true })`, context);
  assert.equal(run('session.cards.length', context), 2);
  assert.equal(run('session.cards.map(c => c.id).join(\',\')', context), 'a,b');
});

test('study durations and export helpers format safely', () => {
  const context = makeContext();
  run(source, context);
  assert.equal(run('formatStudySeconds(59)', context), '59s');
  assert.equal(run('formatStudySeconds(60)', context), '1m');
  assert.equal(run('formatStudySeconds(3 * 3600)', context), '3h');
  assert.equal(run(`({ name: 'Test' }).name.replace(/[\\/:*?"<>|]/g, '-')`, context), 'Test');
});

test('switching decks clears stale search filters', () => {
  const context = makeContext();
  run(source, context);
  run(`state.activeDeckId = 'old'; document.getElementById('cardSearch').value = 'Paris';`, context);
  run(`setActiveDeck('new')`, context);
  assert.equal(run(`document.getElementById('cardSearch').value`, context), '');
});

test('dashboard reports due FSRS workload', () => {
  const context = makeContext();
  run(source, context);
  run(`state.studyHistory = []; state.decks = [{
    id: 'deck', name: 'Deck', color: COLORS[0], fsrs: true,
    cards: [
      { id: 'a', front: 'A', back: 'a', starred: false, schedule: { stability: 1, difficulty: 5, due: Date.now() - 1, last: Date.now() - 86_400_000, reps: 1, lapses: 0 } },
      { id: 'b', front: 'B', back: 'b', starred: false, schedule: { stability: 1, difficulty: 5, due: Date.now() + 86_400_000, last: Date.now(), reps: 1, lapses: 0 } }
    ]
  }]; renderHome();`, context);
  assert.match(run(`document.getElementById('homeStats').innerHTML`, context), /Due reviews/);
});

test('note study markup exposes explanations and Space support', () => {
  assert.match(source, /showNoteExplanation\(item\.explanation/);
  assert.match(source, /noteAnswerBtns \.ans-btn\.good/);
  assert.match(source, /Space.*answers/);
});
