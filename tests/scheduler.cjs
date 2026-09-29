const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
const start = script.indexOf('// ==================== FSRS ====================');
const end = script.indexOf('// ==================== STUDY SESSION ====================');
assert(start !== -1 && end > start, 'FSRS scheduler block not found');
const schedulerBlock = script.slice(start, end);
const schedulerExports = {};
new Function('schedulerExports', `${schedulerBlock}\nObject.assign(schedulerExports, { normalizeFsrsState, fsrsSchedule, fsrsCounts, fsrsQueue, isCardDue, fsrsIntervalDays });`)(schedulerExports);

const {
  normalizeFsrsState, fsrsSchedule, fsrsCounts, fsrsQueue, isCardDue,
} = schedulerExports;
const now = Date.UTC(2026, 8, 29, 12);

// Ratings have ordered initial stability.
const ratings = [1, 2, 3, 4].map(rating => fsrsSchedule({ schedule: null }, rating, now));
for (let i = 1; i < ratings.length; i++) assert.ok(ratings[i].stability > ratings[i - 1].stability, 'higher initial ratings must be more stable');
assert.equal(ratings[0].reps, 1);
assert.equal(ratings[0].lapses, 1);

// Normalization rejects malformed stored state but preserves valid state.
assert.equal(normalizeFsrsState({}), null);
assert.equal(normalizeFsrsState({ stability: 0, difficulty: 3, due: now, last: now }), null);
const valid = normalizeFsrsState({ stability: 4.2, difficulty: 6.5, due: now, last: now, reps: 2, lapses: 1 });
assert.equal(valid.stability, 4.2);
assert.equal(valid.difficulty, 6.5);
assert.equal(valid.reps, 2);

// A mature, almost-new card should grow most when rated Good or Easy, less when Hard, and reset shortest on Again.
const mature = normalizeFsrsState({ stability: 10, difficulty: 5, due: now, last: now - 9 * 86400000, reps: 4, lapses: 0 });
const outcomes = [1, 2, 3, 4].map(rating => fsrsSchedule({ schedule: mature }, rating, now));
assert.ok(outcomes[0].stability <= mature.stability, 'Again must not increase stability');
assert.ok(outcomes[0].stability < outcomes[1].stability, 'Hard should outperform Again');
assert.ok(outcomes[1].stability < outcomes[2].stability, 'Good should outperform Hard');
assert.ok(outcomes[2].stability < outcomes[3].stability, 'Easy should outperform Good');
assert.ok(outcomes[3].difficulty < outcomes[0].difficulty, 'Easy should reduce difficulty relative to Again');

// Due queue sorts overdue work first, then new cards in deck order.
const overdue = normalizeFsrsState({ stability: 2, difficulty: 5, due: now - 1000, last: now - 3 * 86400000 });
const later = normalizeFsrsState({ stability: 2, difficulty: 5, due: now + 1000, last: now - 3 * 86400000 });
const cards = [
  { id: 'later', schedule: later },
  { id: 'new', schedule: null },
  { id: 'overdue', schedule: overdue },
];
assert.deepEqual(fsrsQueue({ cards }).map(c => c.id), ['overdue', 'later', 'new']);
assert.deepEqual(fsrsCounts({ cards }), { due: 2, fresh: 1, total: 3, reviewable: 3 });

// Toggling awareness: cards without a schedule are due; mature future cards are not.
assert.equal(isCardDue({ schedule: null }, now), true);
assert.equal(isCardDue({ schedule: later }, now), false);

console.log('FSRS scheduler: OK');
