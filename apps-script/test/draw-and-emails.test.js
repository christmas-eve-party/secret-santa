import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackend } from './fake-apps-script.js';

const { makeAssignments, shuffle, confirmationEmail, matchEmail, cleanName, cleanEmail, EVENT } = loadBackend();
const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

test('the draw needs at least 3 people and no duplicates', () => {
  assert.throws(() => makeAssignments([]), /at least 3/);
  assert.throws(() => makeAssignments(['a', 'b']), /at least 3/);
  assert.throws(() => makeAssignments(['a', 'b', 'a']), /Duplicate/);
});

test('everyone gives once, gets once, never themselves, all in one loop', () => {
  for (let n = 3; n <= 90; n++) {
    for (let trial = 0; trial < 20; trial++) {
      const everyone = ids(n);
      const pairs = makeAssignments(everyone);
      const givesTo = new Map(pairs.map((p) => [p.giver, p.receiver]));
      assert.equal(givesTo.size, n, 'each person gives exactly once');
      assert.equal(new Set(pairs.map((p) => p.receiver)).size, n, 'each person gets exactly once');
      for (const [giver, receiver] of givesTo) assert.notEqual(giver, receiver, 'nobody gets themselves');
      const seen = new Set();
      let current = everyone[0];
      do {
        seen.add(current);
        current = givesTo.get(current);
      } while (current !== everyone[0]);
      assert.equal(seen.size, n, 'one loop through everyone, no little side loops');
    }
  }
});

test('the odds are fair: you are equally likely to get anyone else', () => {
  const counts = { p1: 0, p2: 0, p3: 0 };
  const trials = 6000;
  for (let i = 0; i < trials; i++) counts[makeAssignments(ids(4)).find((p) => p.giver === 'p0').receiver]++;
  for (const [person, count] of Object.entries(counts)) {
    assert.ok(Math.abs(count - trials / 3) < 250, `${person} picked ${count} times out of ${trials}`);
  }
});

test('shuffle keeps every item and leaves the original alone', () => {
  const original = ids(30);
  const shuffled = shuffle(original);
  assert.deepEqual([...shuffled].sort(), [...original].sort());
  assert.deepEqual(original, ids(30));
});

test('match email says who you got, but not in the subject or the preview', () => {
  const email = matchEmail({ name: 'Maria', receiverName: 'Tyler Brooks', event: EVENT });
  assert.ok(email.text.includes('Tyler Brooks'));
  assert.ok(email.html.includes('Tyler Brooks'));
  assert.ok(!email.subject.includes('Tyler'));
  assert.ok(!email.text.slice(0, 150).includes('Tyler'), 'name stays out of inbox previews');
});

test('names are escaped so nobody can sneak links or HTML into the emails', () => {
  const sneaky = '<a href="https://evil.example">click</a>';
  for (const email of [
    confirmationEmail({ name: sneaky, event: EVENT }),
    matchEmail({ name: sneaky, receiverName: sneaky, event: EVENT }),
  ]) {
    assert.ok(!email.html.includes('<a href'));
    assert.ok(email.html.includes('&lt;a href='));
  }
});

test('party details show up in both emails', () => {
  for (const email of [
    confirmationEmail({ name: 'Maria', event: EVENT }),
    matchEmail({ name: 'Maria', receiverName: 'Tyler', event: EVENT }),
  ]) {
    assert.ok(email.text.includes(EVENT.budget));
    assert.ok(email.text.includes(EVENT.when));
    assert.ok(email.html.includes(EVENT.budget));
  }
});

test('names and emails get tidied, junk gets rejected', () => {
  assert.equal(cleanName('  Maria   G. '), 'Maria G.');
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('x'.repeat(51)), null);
  assert.equal(cleanEmail(' Maria.G@Gmail.com '), 'maria.g@gmail.com');
  for (const bad of ['', 'maria', 'maria@', 'maria@gmail', 'maria @gmail.com', null]) {
    assert.equal(cleanEmail(bad), null, String(bad));
  }
});
