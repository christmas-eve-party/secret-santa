// Checks the sign-up form before it's sent. The server checks again (functions/src/validate.js).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Returns { field: message } for each problem, or {} if the form is good. */
export function validateSignup({ name, email, email2 }) {
  const errors = {};
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName) errors.name = 'Enter your name.';
  else if (cleanName.length > 50) errors.name = 'Keep your name under 50 characters.';

  if (!cleanEmail) errors.email = 'Enter your email.';
  else if (!EMAIL_RE.test(cleanEmail)) errors.email = "That doesn't look like an email address.";
  else if (email2.trim().toLowerCase() !== cleanEmail) errors.email2 = "The two emails don't match.";

  return errors;
}

// Typos in these get a "Did you mean...?" nudge.
const COMMON_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'live.com',
  'msn.com',
  'me.com',
  'mail.com',
  'ymail.com',
  'att.net',
  'comcast.net',
];

/** If the part after @ looks like a typo of a common domain (gmial.com), returns the fixed email. */
export function suggestEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (domain.length < 4 || COMMON_DOMAINS.includes(domain)) return null;

  let best = null;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best ? `${email.slice(0, at)}@${best.candidate}` : null;
}

// How many single-letter edits turn a into b. Swapped letters count as one edit.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}
