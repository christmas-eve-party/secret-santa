// Loads Code.gs into a sandbox with pretend versions of the Apps Script services it uses
// (Script properties, locks, cache, email), so the tests can run it without Google.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

export function loadBackend({ emailsLeftToday = 100 } = {}) {
  const store = new Map(); // Script properties
  const cache = new Map();
  const outbox = []; // every email that "went out"
  const failNext = new Set(); // addresses whose next email should fail
  const quota = { left: emailsLeftToday };

  const scriptProperties = {
    getProperty: (key) => (store.has(key) ? store.get(key) : null),
    setProperty: (key, value) => {
      store.set(key, String(value));
      return scriptProperties;
    },
    setProperties: (values) => {
      for (const [key, value] of Object.entries(values)) store.set(key, String(value));
      return scriptProperties;
    },
    getProperties: () => Object.fromEntries(store),
    deleteProperty: (key) => {
      store.delete(key);
      return scriptProperties;
    },
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => cache.set(key, String(value)),
      }),
    },
    MailApp: {
      getRemainingDailyQuota: () => quota.left,
      sendEmail(message) {
        if (quota.left <= 0) throw new Error('Service invoked too many times for one day: email.');
        if (failNext.delete(message.to)) throw new Error('Failed to send email: try again later');
        quota.left--;
        outbox.push(message);
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ setMimeType: () => ({ getContent: () => content }) }),
    },
    Utilities: { getUuid: () => randomUUID() },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(CODE, context, { filename: 'Code.gs' });
  const inside = vm.runInContext(
    '({ EVENT, makeAssignments, shuffle, confirmationEmail, matchEmail, cleanName, cleanEmail, startOver })',
    context,
  );

  // Calls the web app the way the website does: a POST with a JSON body.
  const call = (action, data = {}) =>
    JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action, ...data }) } }).getContent());
  const get = () => JSON.parse(sandbox.doGet({}).getContent());

  return { call, get, store, outbox, failNext, quota, ...inside };
}
