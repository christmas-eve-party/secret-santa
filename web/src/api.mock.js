// Fake backend for the click-through demo (`npm run build:demo`).
// Same shape and same rules as api.js, but it all lives in memory:
// nothing is saved and no emails go out.

const EVENT = {
  partyName: 'Christmas Eve Party',
  when: 'Thursday, Dec 24 at 5:30 PM, right after close',
  budget: '$20',
  organizer: 'Kura',
  note: "Heads up: if you're coming, please be ready to pitch in on a quick closing task so we can get the party going sooner!",
};

const SEED = [
  ['Maria Gonzalez', 'maria.g@example.com'],
  ['Tyler Brooks', 'tbrooks@example.com'],
  ['Ashley Nguyen', 'ashley.nguyen@example.com'],
  ['Marcus Reed', 'marcus.reed@example.com'],
  ['Hannah Lee', 'hannah.lee@example.com'],
  ['Diego Ramirez', 'diego.r@example.com'],
  ['Brianna Scott', 'bri.scott@example.com'],
];

// The first match email to this address "fails", so the demo shows how resending works.
const FLAKY_EMAIL = 'diego.r@example.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const HOUR = 60 * 60 * 1000;

let state = freshState();
let emailsLeftToday = 100 - SEED.length; // Gmail's daily limit, minus the seed sign-ups' confirmations
let user = null;
const authListeners = new Set();

function freshState() {
  const now = Date.now();
  return {
    status: 'open',
    drawnAt: null,
    flakyFailedOnce: false,
    people: SEED.map(([name, email], i) => ({
      id: `demo${i + 1}`,
      name,
      email,
      joinedAt: now - (SEED.length - i) * 20 * HOUR,
      confirmEmail: 'sent',
      matchEmail: null,
      matchEmailError: null,
    })),
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (value) => JSON.parse(JSON.stringify(value));

function fail(code, message) {
  throw Object.assign(new Error(message), { code, fromServer: true });
}

function sendMatchEmails(people) {
  emailsLeftToday -= people.length;
  let sent = 0;
  for (const person of people) {
    if (person.email === FLAKY_EMAIL && !state.flakyFailedOnce) {
      state.flakyFailedOnce = true;
      person.matchEmail = 'failed';
      person.matchEmailError = '421 4.7.0 Try again later, closing connection.';
    } else {
      person.matchEmail = 'sent';
      person.matchEmailError = null;
      sent++;
    }
  }
  return { sent, failed: people.length - sent };
}

function setUser(next) {
  user = next;
  authListeners.forEach((listener) => listener(user));
}

export const api = {
  async getStatus() {
    await pause(350);
    return { status: state.status, event: EVENT };
  },

  async signUp({ name, email }) {
    await pause(900);
    const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim();
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    if (!cleanName || cleanName.length > 50) fail('invalid-argument', 'Please enter your name (50 characters max).');
    if (!EMAIL_RE.test(cleanEmail)) fail('invalid-argument', "That email address doesn't look right.");
    if (state.status !== 'open') fail('failed-precondition', 'Sign-ups are closed.');
    if (state.people.some((p) => p.email === cleanEmail)) fail('already-exists', 'That email is already signed up.');
    emailsLeftToday--;
    state.people.push({
      id: `demo${Date.now()}`,
      name: cleanName,
      email: cleanEmail,
      joinedAt: Date.now(),
      confirmEmail: 'sent',
      matchEmail: null,
      matchEmailError: null,
    });
    return { name: cleanName, confirmation: 'sent' };
  },

  admin: {
    async overview() {
      await pause(400);
      return copy({ status: state.status, drawnAt: state.drawnAt, people: state.people, emailsLeftToday });
    },
    async setSignupsOpen({ open }) {
      await pause(500);
      if (state.status === 'drawn') fail('failed-precondition', 'Names were already drawn.');
      state.status = open ? 'open' : 'closed';
      return { status: state.status };
    },
    async removePerson({ id }) {
      await pause(500);
      if (state.status === 'drawn') fail('failed-precondition', "Names were already drawn, so people can't be removed.");
      state.people = state.people.filter((p) => p.id !== id);
      return { removed: id };
    },
    async drawNames() {
      await pause(1800);
      if (state.status === 'drawn') fail('failed-precondition', 'Names were already drawn.');
      if (state.status !== 'closed') fail('failed-precondition', 'Close sign-ups before drawing names.');
      if (state.people.length < 3) fail('failed-precondition', 'You need at least 3 people to draw names.');
      state.status = 'drawn';
      state.drawnAt = Date.now();
      return sendMatchEmails(state.people);
    },
    async sendEmails({ id } = {}) {
      await pause(900);
      if (state.status !== 'drawn') fail('failed-precondition', "Names haven't been drawn yet.");
      const targets = id ? state.people.filter((p) => p.id === id) : state.people.filter((p) => p.matchEmail !== 'sent');
      return sendMatchEmails(targets);
    },
  },

  auth: {
    onChange(callback) {
      authListeners.add(callback);
      callback(user);
      return () => authListeners.delete(callback);
    },
    async signIn(password) {
      await pause(500);
      if (!password) fail('permission-denied', 'Wrong admin password.');
      setUser({});
    },
    async signOut() {
      setUser(null);
    },
  },

  demo: {
    reset() {
      state = freshState();
      emailsLeftToday = 100 - SEED.length;
      setUser(null);
    },
  },
};
