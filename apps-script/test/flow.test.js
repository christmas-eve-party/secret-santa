// Runs Code.gs from start to finish with pretend Apps Script services.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackend } from './fake-apps-script.js';

const PASSWORD = 'candy-cane-42';
const PEOPLE = [
  ['Maria Gonzalez', 'maria@example.com'],
  ['Tyler Brooks', 'tyler@example.com'],
  ['Ashley Nguyen', 'ashley@example.com'],
  ['Marcus Reed', 'marcus@example.com'],
  ['Diego Ramirez', 'diego@example.com'],
];

function setUp(options) {
  const backend = loadBackend(options);
  backend.store.set('ADMIN_PASSWORD', PASSWORD);
  const admin = (action, data = {}) => backend.call(`admin.${action}`, { password: PASSWORD, ...data });
  const fails = (result, code) => {
    assert.equal(result.ok, false, `expected ${code}, got success`);
    assert.equal(result.code, code, result.message);
  };
  const participantCount = () => [...backend.store.keys()].filter((key) => key.startsWith('person:')).length;
  return { ...backend, admin, fails, participantCount };
}

test('opening the web app URL shows that it works', () => {
  const { get } = setUp();
  const result = get();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'open');
  assert.equal(result.event.budget, '$20');
});

test('sign-ups check names, emails, and duplicates', () => {
  const { call, fails, outbox, participantCount } = setUp();
  assert.equal(call('getStatus').status, 'open', 'open by default');

  assert.deepEqual(call('signUp', { name: '  Maria   Gonzalez ', email: ' Maria@Example.com ' }), {
    ok: true,
    name: 'Maria Gonzalez',
    confirmation: 'sent',
  });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'maria@example.com');
  assert.equal(outbox[0].name, 'Secret Santa');

  fails(call('signUp', { name: 'Maria Again', email: 'MARIA@example.com' }), 'already-exists');
  fails(call('signUp', { name: '', email: 'someone@example.com' }), 'invalid-argument');
  fails(call('signUp', { name: 'Someone', email: 'not-an-email' }), 'invalid-argument');
  fails(call('signUp', {}), 'invalid-argument');
  fails(call('noSuchThing'), 'invalid-argument');
  assert.equal(participantCount(), 1);
});

test('admin actions need the right password', () => {
  const { call, admin, fails, store } = setUp();
  for (const action of ['overview', 'setSignupsOpen', 'removePerson', 'drawNames', 'sendEmails']) {
    fails(call(`admin.${action}`), 'permission-denied');
    fails(call(`admin.${action}`, { password: 'wrong' }), 'permission-denied');
  }
  assert.equal(admin('overview').status, 'open');

});

test('with no admin password yet, the script makes one and emails it to the organizer', () => {
  const { call, store, outbox, fails } = setUp();
  store.delete('ADMIN_PASSWORD');
  const first = call('admin.overview', { password: 'anything' });
  fails(first, 'failed-precondition');
  assert.match(first.message, /emailed to the organizer/);
  assert.ok(!first.message.includes('@'), "the organizer's address isn't shown to whoever opened the admin page");

  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'owner@example.com');
  const password = store.get('ADMIN_PASSWORD');
  assert.match(password, /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/);
  assert.ok(outbox[0].body.includes(password));

  assert.equal(call('admin.overview', { password }).ok, true, 'the emailed password works');
  fails(call('admin.overview', { password: 'anything' }), 'permission-denied');
  assert.equal(outbox.length, 1, 'only emailed once');
});

test("if the password email can't go out, no password is saved, so the next try emails again", () => {
  const { call, store, failNext, outbox } = setUp();
  store.delete('ADMIN_PASSWORD');
  failNext.add('owner@example.com');
  assert.equal(call('admin.overview', { password: 'x' }).code, 'unavailable');
  assert.equal(store.get('ADMIN_PASSWORD'), undefined);
  assert.equal(call('admin.overview', { password: 'x' }).code, 'failed-precondition');
  assert.equal(outbox.length, 1);
});

test('too many wrong passwords locks the admin page for a while', () => {
  const { call, admin, fails } = setUp();
  for (let i = 0; i < 20; i++) fails(call('admin.overview', { password: `guess${i}` }), 'permission-denied');
  fails(call('admin.overview', { password: 'one more guess' }), 'resource-exhausted');
  fails(admin('overview'), 'resource-exhausted'); // even the right one, until the 10 minutes pass
});

test('the whole flow: sign up, remove, close, draw, email, resend', () => {
  const { call, admin, fails, store, outbox, failNext, participantCount } = setUp();
  for (const [name, email] of PEOPLE) call('signUp', { name, email });
  let overview = admin('overview');
  assert.deepEqual(overview.people.map((p) => p.name), PEOPLE.map(([name]) => name), 'in sign-up order');
  assert.ok(overview.people.every((p) => p.confirmEmail === 'sent'));
  assert.equal(overview.emailsLeftToday, 95);

  // Can't draw while sign-ups are open
  fails(admin('drawNames'), 'failed-precondition');

  // Remove someone before the draw
  const marcus = overview.people.find((p) => p.name === 'Marcus Reed');
  assert.equal(admin('removePerson', { id: marcus.id }).removed, marcus.id);
  fails(admin('removePerson', { id: '../state' }), 'invalid-argument');
  assert.equal(participantCount(), 4);

  // Closing turns away late sign-ups; reopening works before the draw
  admin('setSignupsOpen', { open: false });
  assert.equal(call('getStatus').status, 'closed');
  fails(call('signUp', { name: 'Late Larry', email: 'larry@example.com' }), 'failed-precondition');
  admin('setSignupsOpen', { open: true });
  assert.equal(call('getStatus').status, 'open');
  admin('setSignupsOpen', { open: false });

  // Draw names, with Diego's email failing
  outbox.length = 0;
  failNext.add('diego@example.com');
  const drawn = admin('drawNames');
  assert.deepEqual({ sent: drawn.sent, failed: drawn.failed }, { sent: 3, failed: 1 });

  // The matches make one loop through all 4 people, nobody gets themselves
  overview = admin('overview');
  const nameOf = new Map(overview.people.map((p) => [p.id, p.name]));
  const idOfEmail = new Map(overview.people.map((p) => [p.email, p.id]));
  const givesTo = new Map(
    [...store].filter(([key]) => key.startsWith('match:')).map(([key, receiver]) => [key.slice(6), receiver]),
  );
  assert.equal(givesTo.size, 4);
  const start = overview.people[0].id;
  const seen = new Set();
  let current = start;
  do {
    assert.notEqual(givesTo.get(current), current);
    seen.add(current);
    current = givesTo.get(current);
  } while (current !== start);
  assert.equal(seen.size, 4);

  // Each email names the right person, and never in the subject
  assert.equal(outbox.length, 3);
  for (const email of outbox) {
    const receiverName = nameOf.get(givesTo.get(idOfEmail.get(email.to)));
    assert.ok(email.body.includes(receiverName), `${email.to} should be told ${receiverName}`);
    assert.ok(email.htmlBody.includes(receiverName));
    assert.ok(!email.subject.includes(receiverName));
  }

  // The admin page shows email status but never who got whom
  assert.equal(overview.status, 'drawn');
  assert.ok(overview.drawnAt > 0);
  assert.ok(!JSON.stringify(overview).includes('match:'));
  for (const receiverId of givesTo.values()) {
    assert.ok(!JSON.stringify(overview.people.map(({ id, ...rest }) => rest)).includes(receiverId));
  }
  const diego = overview.people.find((p) => p.name === 'Diego Ramirez');
  assert.equal(diego.matchEmail, 'failed');
  assert.match(diego.matchEmailError, /try again later/);

  // After the draw: no redraw, no removing, no reopening, no new sign-ups
  fails(admin('drawNames'), 'failed-precondition');
  fails(admin('removePerson', { id: diego.id }), 'failed-precondition');
  fails(admin('setSignupsOpen', { open: true }), 'failed-precondition');
  fails(call('signUp', { name: 'Late Larry', email: 'larry@example.com' }), 'failed-precondition');

  // "Send unsent emails" only sends Diego's
  outbox.length = 0;
  const unsent = admin('sendEmails');
  assert.deepEqual({ sent: unsent.sent, failed: unsent.failed }, { sent: 1, failed: 0 });
  assert.deepEqual(outbox.map((e) => e.to), ['diego@example.com']);

  // Resending one person's email works, and then nothing is left unsent
  assert.equal(admin('sendEmails', { id: diego.id }).sent, 1);
  assert.equal(admin('sendEmails').sent, 0);
  overview = admin('overview');
  assert.ok(overview.people.every((p) => p.matchEmail === 'sent' && p.matchEmailError === null));
});

test('drawing needs at least 3 people, and a refused draw changes nothing', () => {
  const { call, admin, fails, store } = setUp();
  call('signUp', { name: 'Only One', email: 'one@example.com' });
  call('signUp', { name: 'Only Two', email: 'two@example.com' });
  admin('setSignupsOpen', { open: false });
  fails(admin('drawNames'), 'failed-precondition');
  assert.equal(call('getStatus').status, 'closed');
  assert.ok(![...store.keys()].some((key) => key.startsWith('match:')));
});

test("the draw waits for tomorrow if Gmail's daily limit can't cover everyone", () => {
  const { call, admin, fails, quota, store } = setUp();
  for (const [name, email] of PEOPLE) call('signUp', { name, email });
  admin('setSignupsOpen', { open: false });
  quota.left = 4; // 5 people, room for 4 emails
  const result = admin('drawNames');
  fails(result, 'resource-exhausted');
  assert.match(result.message, /4 more emails today/);
  assert.equal(call('getStatus').status, 'closed', 'nothing drawn yet');
  assert.ok(![...store.keys()].some((key) => key.startsWith('match:')));
});

test('if the confirmation email fails, the sign-up still counts and the admin sees it', () => {
  const { call, admin, failNext } = setUp();
  failNext.add('maria@example.com');
  assert.equal(call('signUp', { name: 'Maria', email: 'maria@example.com' }).confirmation, 'failed');
  assert.equal(admin('overview').people[0].confirmEmail, 'failed');
});
