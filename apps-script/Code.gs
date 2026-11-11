/**
 * Secret Santa backend: a Google Apps Script web app.
 *
 * The website (on GitHub Pages) sends every request here as a POST with a JSON body,
 * like { action: 'signUp', name, email } or { action: 'admin.drawNames', password },
 * and gets JSON back: { ok: true, ...result } or { ok: false, code, message }.
 *
 * Everything is kept in this script's Script properties (Project Settings > Script properties):
 *   ADMIN_PASSWORD  the admin page password. The script makes it and emails it to you (see setup()).
 *   state           { status: 'open' | 'closed' | 'drawn', drawnAt }
 *   person:<id>     one per person who signed up
 *   match:<id>      who that person gives to. The website never gets these, not even the admin page.
 *
 * Emails go out from the Google account that deploys this script.
 */

// ---------- Party details: shown on the sign-up page and in both emails ----------

const EVENT = {
  partyName: 'Christmas Eve Party',
  when: 'Thursday, Dec 24 at 6:00 PM, right after close',
  budget: '$20',
  organizer: 'Jacob and Nic',
  // Shown near the top of the sign-up page. Set to '' to hide it.
  signupNote: "Sign up by Thursday, Dec 10. If you don't know if you can make it, please don't sign up.",
  // Small print at the bottom of the sign-up page and the match email. Set to '' to hide it.
  note: '',
};

// Send a "you're signed up" email right after someone signs up, so a mistyped address shows up before the draw.
const SEND_SIGNUP_CONFIRMATION = true;

// Gmail lets Apps Script email 100 people a day from a regular account, and the draw emails everyone
// at once, so sign-ups stop here to leave room.
const MAX_PEOPLE = 90;

// The script makes the admin page password itself the first time you run setup() (or the first time
// someone opens the admin page) and emails it to the Google account that owns this script.
// To send it somewhere else instead, put an address here, like 'someone@gmail.com'.
const ORGANIZER_EMAIL = '';

// Run this once from the editor (pick "setup" next to Run). It asks for permission to send email,
// then emails the admin password to you.
function setup() {
  const sent = emailAdminPassword();
  console.log(sent ? 'Admin password emailed to ' + organizerEmail() : 'Admin password was already set (see Script properties)');
}

// Run this from the editor after a test run (pick "startOver" next to Run). It wipes everyone who
// signed up, the draw, and the matches, and opens sign-ups again. The admin password stays the same.
// There's no undo, so check the list on the admin page first.
function startOver() {
  const removed = withLock(() => {
    const all = props().getProperties();
    const names = [];
    Object.keys(all).forEach((key) => {
      if (key.indexOf('person:') === 0) names.push(JSON.parse(all[key]).name);
      if (key === 'state' || key.indexOf('person:') === 0 || key.indexOf('match:') === 0) props().deleteProperty(key);
    });
    return names;
  });
  console.log('Started over. Removed ' + removed.length + ' people: ' + (removed.join(', ') || 'nobody') + '. Sign-ups are open.');
  return removed.length;
}

function organizerEmail() {
  return ORGANIZER_EMAIL || Session.getEffectiveUser().getEmail();
}

// ---------- Web app entry points ----------

function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return reply({ ok: false, code: 'invalid-argument', message: 'Bad request.' });
  }
  try {
    const action = ACTIONS[request.action];
    if (!action) throw new AppError('invalid-argument', 'Unknown action.');
    return reply(Object.assign({ ok: true }, action(request)));
  } catch (err) {
    if (err instanceof AppError) return reply({ ok: false, code: err.code, message: err.message });
    console.error(err);
    return reply({ ok: false, code: 'internal', message: 'Something went wrong on the server. Try again in a minute.' });
  }
}

// Opening the web app URL in a browser shows this, which is a quick way to check it's working.
function doGet() {
  return reply({ ok: true, status: readState().status, event: EVENT });
}

const ACTIONS = {
  getStatus: () => ({ status: readState().status, event: EVENT }),
  signUp: signUp,
  'admin.overview': adminOnly(overview),
  'admin.setSignupsOpen': adminOnly(setSignupsOpen),
  'admin.removePerson': adminOnly(removePerson),
  'admin.drawNames': adminOnly(drawNames),
  'admin.sendEmails': adminOnly(sendEmails),
};

// ---------- Sign-up page ----------

function signUp(request) {
  const name = cleanName(request.name);
  const email = cleanEmail(request.email);
  if (!name) throw new AppError('invalid-argument', 'Please enter your name (50 characters max).');
  if (!email) throw new AppError('invalid-argument', "That email address doesn't look right.");

  const person = withLock(() => {
    if (readState().status !== 'open') throw new AppError('failed-precondition', 'Sign-ups are closed.');
    const people = readPeople();
    if (people.some((p) => p.email === email)) throw new AppError('already-exists', 'That email is already signed up.');
    if (people.length >= MAX_PEOPLE) throw new AppError('resource-exhausted', 'The Secret Santa is full.');
    const newPerson = {
      id: Utilities.getUuid().replace(/-/g, '').slice(0, 20),
      name: name,
      email: email,
      joinedAt: Date.now(),
      confirmEmail: null,
      matchEmail: null,
      matchEmailError: null,
    };
    savePerson(newPerson);
    return newPerson;
  });

  if (!SEND_SIGNUP_CONFIRMATION) return { name: name, confirmation: 'off' };
  const error = sendEmail(email, confirmationEmail({ name: name, event: EVENT }));
  updatePerson(person.id, { confirmEmail: error ? 'failed' : 'sent' });
  return { name: name, confirmation: error ? 'failed' : 'sent' };
}

// ---------- Admin page ----------

function overview() {
  const state = readState();
  return {
    status: state.status,
    drawnAt: state.drawnAt || null,
    people: readPeople(),
    emailsLeftToday: MailApp.getRemainingDailyQuota(),
  };
}

function setSignupsOpen(request) {
  return withLock(() => {
    const state = readState();
    if (state.status === 'drawn') throw new AppError('failed-precondition', 'Names were already drawn.');
    state.status = request.open === true ? 'open' : 'closed';
    writeState(state);
    return { status: state.status };
  });
}

function removePerson(request) {
  const id = requireId(request.id);
  return withLock(() => {
    if (readState().status === 'drawn') {
      throw new AppError('failed-precondition', "Names were already drawn, so people can't be removed.");
    }
    props().deleteProperty('person:' + id);
    return { removed: id };
  });
}

function drawNames() {
  const ids = withLock(() => {
    const state = readState();
    if (state.status === 'drawn') throw new AppError('failed-precondition', 'Names were already drawn.');
    if (state.status !== 'closed') throw new AppError('failed-precondition', 'Close sign-ups before drawing names.');
    const people = readPeople();
    if (people.length < 3) throw new AppError('failed-precondition', 'You need at least 3 people to draw names.');
    const left = MailApp.getRemainingDailyQuota();
    if (left < people.length) {
      throw new AppError(
        'resource-exhausted',
        'Gmail only lets this send ' + left + ' more emails today, and the draw needs ' + people.length + '. Try again tomorrow.',
      );
    }

    const matches = {};
    makeAssignments(people.map((p) => p.id)).forEach((pair) => {
      matches['match:' + pair.giver] = pair.receiver;
    });
    props().setProperties(matches);
    writeState({ status: 'drawn', drawnAt: Date.now() });
    return people.map((p) => p.id);
  });
  console.log('Names drawn for ' + ids.length + ' people');
  return sendMatchEmails(ids);
}

// With { id }: resend that one person's match email.
// Without: send to everyone whose match email hasn't gone out yet.
function sendEmails(request) {
  if (readState().status !== 'drawn') throw new AppError('failed-precondition', "Names haven't been drawn yet.");
  const ids = request.id
    ? [requireId(request.id)]
    : readPeople()
        .filter((p) => p.matchEmail !== 'sent')
        .map((p) => p.id);
  if (ids.length === 0) return { sent: 0, failed: 0 };
  const left = MailApp.getRemainingDailyQuota();
  if (left < ids.length) {
    throw new AppError('resource-exhausted', 'Gmail only lets this send ' + left + ' more emails today. Try again tomorrow.');
  }
  return sendMatchEmails(ids);
}

// Emails each of these people who they got, and records whether it went out.
function sendMatchEmails(ids) {
  const byId = {};
  readPeople().forEach((p) => {
    byId[p.id] = p;
  });
  let sent = 0;
  ids.forEach((id) => {
    const giver = byId[id];
    if (!giver) return;
    const receiver = byId[props().getProperty('match:' + id)];
    const error = receiver
      ? sendEmail(giver.email, matchEmail({ name: giver.name, receiverName: receiver.name, event: EVENT }))
      : 'No match found for this person.';
    if (error) console.error('Match email failed for ' + id + ': ' + error); // never log who they got
    else sent++;
    updatePerson(id, { matchEmail: error ? 'failed' : 'sent', matchEmailError: error || null });
  });
  return { sent: sent, failed: ids.length - sent };
}

// ---------- Admin password ----------

function adminOnly(handler) {
  return (request) => {
    const expected = props().getProperty('ADMIN_PASSWORD');
    if (!expected) {
      emailAdminPassword();
      throw new AppError('failed-precondition', 'The admin password was just emailed to the organizer. Sign in with it.');
    }
    const cache = CacheService.getScriptCache();
    const misses = Number(cache.get('wrong-passwords') || 0);
    if (misses >= 20) throw new AppError('resource-exhausted', 'Too many wrong passwords. Wait 10 minutes and try again.');
    if (typeof request.password !== 'string' || !sameText(request.password, expected)) {
      cache.put('wrong-passwords', String(misses + 1), 600);
      throw new AppError('permission-denied', 'Wrong admin password.');
    }
    return handler(request);
  };
}

// Makes an admin password and emails it to the organizer, unless one is already set.
// Returns true if it made one. Only saves it once the email has gone out.
function emailAdminPassword() {
  return withLock(() => {
    if (props().getProperty('ADMIN_PASSWORD')) return false;
    const password = makePassword();
    const error = sendEmail(organizerEmail(), adminPasswordEmail(password));
    if (error) throw new AppError('unavailable', "Couldn't email the admin password: " + error);
    props().setProperty('ADMIN_PASSWORD', password);
    return true;
  });
}

// Like "cocoa-sleigh-mitten-482": easy to type on a phone, hard to guess.
function makePassword() {
  const words = ['candy', 'cane', 'sleigh', 'reindeer', 'snow', 'tinsel', 'cocoa', 'mitten',
    'holly', 'frost', 'jingle', 'cookie', 'ribbon', 'star', 'pine', 'gift', 'bells', 'scarf', 'sled', 'wreath'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return [pick(), pick(), pick(), String(Math.floor(Math.random() * 900) + 100)].join('-');
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- The draw ----------

/** Fisher-Yates shuffle. Returns a new array and leaves the input alone. */
function shuffle(items, random) {
  const rand = random || Math.random;
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)); // 0..i
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * Draws names: shuffles everyone into one big loop and has each person give to the
 * next one (A -> B -> C -> ... -> A). Nobody can get themselves, and with 3+ people
 * nobody ends up just swapping gifts with one other person. Returns [{ giver, receiver }].
 */
function makeAssignments(ids, random) {
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate participant ids');
  if (ids.length < 3) throw new Error('Need at least 3 people to draw names');
  const loop = shuffle(ids, random);
  return loop.map((giver, i) => ({ giver: giver, receiver: loop[(i + 1) % loop.length] }));
}

// ---------- Emails: edit the wording here ----------

const COLORS = { pine: '#1f4d3a', berry: '#b3263a', gold: '#c8902e', snow: '#fbf8f2', ink: '#1d2420', muted: '#5d6b63' };

function confirmationEmail(args) {
  const name = args.name;
  const event = args.event;
  return {
    subject: "You're in for Secret Santa 🎄",
    text: [
      'Hi ' + name + ',',
      '',
      "You're signed up for the Secret Santa at the " + event.partyName + '.',
      "Once names are drawn, you'll get another email telling you who you're shopping for.",
      '',
      'Spending limit: ' + event.budget,
      'Party: ' + event.when,
      '',
      'Questions? Ask ' + event.organizer + '.',
    ].join('\n'),
    html: emailLayout({
      preheader: "You're signed up! Your person comes in a later email.",
      heading: "You're in, " + esc(name) + '!',
      body: [
        para(
          "You're signed up for the Secret Santa at the <strong>" + esc(event.partyName) + '</strong>. ' +
            "Once names are drawn, you'll get another email telling you who you're shopping for.",
        ),
        para('<strong>Spending limit:</strong> ' + esc(event.budget) + '<br><strong>Party:</strong> ' + esc(event.when)),
        finePrint('Questions? Ask ' + esc(event.organizer) + '.'),
      ],
    }),
  };
}

function matchEmail(args) {
  const name = args.name;
  const receiverName = args.receiverName;
  const event = args.event;
  // The subject and the first lines stay vague on purpose, so the name doesn't pop up
  // in a lock-screen notification or an inbox preview.
  return {
    subject: 'Your Secret Santa match is here 🎅',
    text: [
      "(Open this when nobody's looking.)",
      '',
      'Hi ' + name + ',',
      '',
      'Names have been drawn for the Secret Santa! The spending limit is ' + event.budget +
        ', and gifts get swapped at the ' + event.partyName + ' (' + event.when + ').',
      '',
      "You're the Secret Santa for:",
      '',
      '    ' + receiverName,
      '',
      'Wrap your gift, put their name on it, and keep it a secret!',
    ]
      .concat(event.note ? ['', event.note] : [])
      .concat(['', 'Questions? Ask ' + event.organizer + '.'])
      .join('\n'),
    html: emailLayout({
      preheader: "Open this when nobody's looking 👀",
      heading: 'Names have been drawn!',
      body: [
        para('Hi ' + esc(name) + ", you're the Secret Santa for:"),
        '<div style="margin:4px 0 20px;padding:20px 16px;border:2px dashed ' + COLORS.gold + ';border-radius:12px;' +
          'text-align:center;font-size:28px;line-height:1.25;color:' + COLORS.berry + ';">' + esc(receiverName) + '</div>',
        para(
          '<strong>Spending limit:</strong> ' + esc(event.budget) + '<br>' +
            '<strong>Gift swap:</strong> ' + esc(event.partyName) + ', ' + esc(event.when),
        ),
        para('Wrap your gift, put their name on it, and keep it a secret! 🤫'),
        event.note ? finePrint(esc(event.note)) : '',
        finePrint('Questions? Ask ' + esc(event.organizer) + '.'),
      ],
    }),
  };
}

function adminPasswordEmail(password) {
  return {
    subject: 'Your Secret Santa admin password',
    text: [
      "Here's the password for the Secret Santa admin page:",
      '',
      '    ' + password,
      '',
      'Open the Secret Santa site, add #admin to the end of the address, and sign in with it.',
      "To change it, edit ADMIN_PASSWORD in the Apps Script project's Project Settings > Script properties.",
    ].join('\n'),
    html: emailLayout({
      preheader: 'For the admin page of the Secret Santa site.',
      heading: 'Your admin password',
      body: [
        para("Here's the password for the Secret Santa admin page:"),
        '<div style="margin:4px 0 20px;padding:16px;border:2px dashed ' + COLORS.gold + ';border-radius:12px;' +
          'text-align:center;font-family:Consolas,Menlo,monospace;font-size:22px;color:' + COLORS.pine + ';">' + esc(password) + '</div>',
        para('Open the Secret Santa site, add <strong>#admin</strong> to the end of the address, and sign in with it.'),
        finePrint("To change it, edit ADMIN_PASSWORD in the Apps Script project's Project Settings &gt; Script properties."),
      ],
    }),
  };
}

function esc(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => map[c]);
}

function para(html) {
  return '<p style="margin:0 0 14px;">' + html + '</p>';
}

function finePrint(html) {
  return (
    '<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:' +
    COLORS.muted + ';">' + html + '</p>'
  );
}

function emailLayout(parts) {
  // Invisible filler after the preheader stops inbox previews from showing the body text.
  const filler = new Array(91).join('&zwnj;&nbsp;');
  return (
    '<!doctype html><html lang="en"><body style="margin:0;padding:0;background:' + COLORS.snow + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' + esc(parts.preheader) + filler + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + COLORS.snow + ';">' +
    '<tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;' +
    'border-radius:14px;border-top:6px solid ' + COLORS.berry + ';">' +
    '<tr><td style="padding:28px 28px 24px;font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.55;color:' +
    COLORS.ink + ';">' +
    '<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;' +
    'text-transform:uppercase;color:' + COLORS.berry + ';">Secret Santa</p>' +
    '<h1 style="margin:6px 0 16px;font-size:26px;line-height:1.2;font-weight:normal;color:' + COLORS.pine + ';">' +
    parts.heading + '</h1>' +
    parts.body.filter(Boolean).join('') +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

// Returns null if the email went out, or what went wrong.
function sendEmail(to, message) {
  try {
    MailApp.sendEmail({ to: to, subject: message.subject, body: message.text, htmlBody: message.html, name: 'Secret Santa' });
    return null;
  } catch (err) {
    return String((err && err.message) || err).slice(0, 300);
  }
}

// ---------- Checking what people type ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Tidies a name. Returns null if it's empty or longer than 50 characters. */
function cleanName(value) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.length > 0 && name.length <= 50 ? name : null;
}

/** Lowercases an email. Returns null if it doesn't look like an email. */
function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function requireId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(value)) throw new AppError('invalid-argument', 'Missing or bad id.');
  return value;
}

// ---------- Storage ----------

function props() {
  return PropertiesService.getScriptProperties();
}

function readState() {
  const raw = props().getProperty('state');
  return raw ? JSON.parse(raw) : { status: 'open' };
}

function writeState(state) {
  props().setProperty('state', JSON.stringify(state));
}

function readPeople() {
  const all = props().getProperties();
  return Object.keys(all)
    .filter((key) => key.indexOf('person:') === 0)
    .map((key) => JSON.parse(all[key]))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

function savePerson(person) {
  props().setProperty('person:' + person.id, JSON.stringify(person));
}

function updatePerson(id, changes) {
  withLock(() => {
    const raw = props().getProperty('person:' + id);
    if (raw) savePerson(Object.assign(JSON.parse(raw), changes));
  });
}

// One change at a time, so two sign-ups with the same email can't both get in,
// and nothing changes while names are being drawn.
function withLock(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new AppError('unavailable', 'The site is busy. Try again in a moment.');
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
