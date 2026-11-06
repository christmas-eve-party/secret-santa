// Everything the site asks of the backend goes through here. The backend is the
// Google Apps Script web app in apps-script/Code.gs, at the address in config.js.
// (The click-through demo swaps this file for api.mock.js.)

import { API_URL } from './config.js';

const PASSWORD_KEY = 'secret-santa-admin';
let password = rememberedPassword();
const authListeners = new Set();

// Sends one request to Code.gs and returns its answer, or throws its error.
async function call(action, data = {}) {
  if (!/^https:\/\/script\.google\.com\//.test(API_URL)) {
    throw serverError('not-set-up', "This site isn't connected to its backend yet. Put the web app URL in web/src/config.js.");
  }
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      // Plain text keeps this a "simple" request, which Apps Script can answer from another website.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...data }),
    });
  } catch {
    throw Object.assign(new Error('Network error'), { code: 'network' });
  }
  const body = await response.json().catch(() => null);
  if (!body) {
    throw serverError(
      'bad-response',
      "The backend didn't answer properly. Check that the Apps Script is deployed as a web app that Anyone can use.",
    );
  }
  if (!body.ok) throw serverError(body.code, body.message);
  const { ok, ...result } = body; // eslint-disable-line no-unused-vars
  return result;
}

// Errors from Code.gs carry a message written for people, which the page shows as is.
function serverError(code, message) {
  return Object.assign(new Error(message), { code, fromServer: true });
}

const admin = (action) => (data = {}) => call(`admin.${action}`, { ...data, password });

export const api = {
  getStatus: () => call('getStatus'),
  signUp: (data) => call('signUp', data),

  admin: {
    overview: admin('overview'),
    setSignupsOpen: admin('setSignupsOpen'),
    removePerson: admin('removePerson'),
    drawNames: admin('drawNames'),
    sendEmails: admin('sendEmails'),
  },

  // "Signed in" means the admin password is remembered in this browser tab until it closes.
  auth: {
    // Calls back with {} when signed in or null when not. Returns an unsubscribe function.
    onChange(callback) {
      authListeners.add(callback);
      callback(password ? {} : null);
      return () => authListeners.delete(callback);
    },
    async signIn(candidate) {
      await call('admin.overview', { password: candidate }); // throws "Wrong admin password." if it's wrong
      setPassword(candidate);
    },
    signOut() {
      setPassword(null);
    },
  },
};

function setPassword(value) {
  password = value;
  try {
    if (value) sessionStorage.setItem(PASSWORD_KEY, value);
    else sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // storage blocked: you stay signed in until the page reloads
  }
  authListeners.forEach((listener) => listener(password ? {} : null));
}

function rememberedPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}
