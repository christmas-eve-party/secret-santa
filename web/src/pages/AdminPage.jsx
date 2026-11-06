import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { friendlyError } from '../errors.js';

const isDemo = import.meta.env.MODE === 'demo';
const signupLink = () => (isDemo ? 'https://your-project-id.web.app' : window.location.href.split('#')[0]);

const formatDay = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const countPeople = (n) => (n === 1 ? '1 person' : `${n} people`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const firstName = (name) => name.split(' ')[0];

function peopleIn(n) {
  if (n === 0) return 'Nobody has signed up yet.';
  return n === 1 ? '1 person is in.' : `${n} people are in.`;
}

function emailSummary({ sent, failed }) {
  return failed ? `${plural(sent, 'email')} sent, ${failed} didn't go out.` : `${plural(sent, 'email')} sent.`;
}

export default function AdminPage() {
  const [user, setUser] = useState(undefined); // undefined while checking, null when signed out
  useEffect(() => api.auth.onChange(setUser), []);

  return (
    <main className="admin">
      <header className="admin__header">
        <h1 className="admin__title">
          <span className="marker">Secret Santa</span> admin
        </h1>
        {user && (
          <button type="button" className="link-button link-button--light" onClick={() => api.auth.signOut()}>
            Sign out
          </button>
        )}
      </header>
      {user === undefined && <p className="admin__loading">Loading…</p>}
      {user === null && <SignIn />}
      {user && <Dashboard />}
    </main>
  );
}

function SignIn() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(e) {
    e.preventDefault();
    if (!password) {
      setError('Enter the admin password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.auth.signIn(password);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form className="sheet sheet--narrow" onSubmit={signIn} noValidate>
      <h2 className="sheet__heading">Organizers only</h2>
      <div className={error ? 'field field--error' : 'field'}>
        <label htmlFor="admin-password">Admin password</label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'admin-password-error' : undefined}
        />
        {isDemo && <p className="field__help">In the demo, any password works.</p>}
        {error && (
          <p className="field__error" id="admin-password-error">
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="button button--primary" disabled={busy}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}

function Dashboard() {
  const [data, setData] = useState(null); // { status, drawnAt, people }
  const [loadError, setLoadError] = useState(null); // { code, text }
  const [busy, setBusy] = useState(''); // which action is running, e.g. 'draw' or 'remove:<id>'
  const [confirming, setConfirming] = useState(''); // 'draw' or 'remove:<id>'
  const [toast, setToast] = useState(null); // { tone, text }

  const load = useCallback(async () => {
    try {
      setData(await api.admin.overview());
      setLoadError(null);
    } catch (error) {
      setLoadError({ code: error?.code, text: friendlyError(error) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (toast?.tone !== 'ok') return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Runs an admin action, shows how it went, then refreshes the page's data.
  async function run(key, action, describe) {
    setBusy(key);
    setToast(null);
    try {
      const result = await action();
      setToast({ tone: result?.failed ? 'warn' : 'ok', text: describe(result) });
    } catch (error) {
      setToast({ tone: 'error', text: friendlyError(error) });
    }
    setConfirming('');
    await load();
    setBusy('');
  }

  if (!data) {
    if (!loadError) return <p className="admin__loading">Loading…</p>;
    return (
      <section className="sheet sheet--narrow">
        <p className="message message--error" role="alert">
          {loadError.text}
        </p>
        {loadError.code === 'permission-denied' && (
          <p className="muted">If the admin password was changed, sign out and sign in with the new one.</p>
        )}
        <div className="button-row">
          <button type="button" className="button button--secondary" onClick={load}>
            Try again
          </button>
          <button type="button" className="button button--quiet" onClick={() => api.auth.signOut()}>
            Sign out
          </button>
        </div>
      </section>
    );
  }

  const { status, people, drawnAt, emailsLeftToday } = data;
  const tooFewEmailsLeft = typeof emailsLeftToday === 'number' && emailsLeftToday < people.length;
  const sentCount = people.filter((p) => p.matchEmail === 'sent').length;
  const unsentCount = people.length - sentCount;
  const step = { open: 1, closed: 2 }[status] ?? (unsentCount > 0 ? 3 : 4);
  const anyBusy = Boolean(busy);

  return (
    <>
      <section className="sheet">
        <ol className="steps">
          <Step number={1} current={step} title="Collect sign-ups">
            {status === 'open' && (
              <>
                <p>Sign-ups are open. {peopleIn(people.length)}</p>
                <ShareLink />
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={anyBusy}
                  onClick={() =>
                    run('close', () => api.admin.setSignupsOpen({ open: false }), () => 'Sign-ups closed. Nobody new can join.')
                  }
                >
                  {busy === 'close' ? 'Closing…' : 'Close sign-ups'}
                </button>
              </>
            )}
            {status === 'closed' && (
              <>
                <p>Sign-ups are closed. {peopleIn(people.length)}</p>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={anyBusy}
                  onClick={() => run('open', () => api.admin.setSignupsOpen({ open: true }), () => 'Sign-ups reopened.')}
                >
                  {busy === 'open' ? 'Reopening…' : 'Reopen sign-ups'}
                </button>
              </>
            )}
            {status === 'drawn' && <p className="muted">Closed with {countPeople(people.length)}.</p>}
          </Step>

          <Step number={2} current={step} title="Draw names">
            {status === 'open' && <p className="muted">Close sign-ups first, then draw names here.</p>}
            {status === 'closed' && people.length < 3 && <p>You need at least 3 people to draw names.</p>}
            {status === 'closed' && people.length >= 3 && confirming !== 'draw' && (
              <>
                <p>Everyone gets an email with their person right away. You won't see the matches.</p>
                {tooFewEmailsLeft && (
                  <p className="message message--error">
                    Gmail only lets this send {emailsLeftToday} more emails today, and the draw needs {people.length}. Try
                    again tomorrow.
                  </p>
                )}
                <button
                  type="button"
                  className="button button--primary"
                  disabled={anyBusy || tooFewEmailsLeft}
                  onClick={() => setConfirming('draw')}
                >
                  Draw names
                </button>
              </>
            )}
            {status === 'closed' && people.length >= 3 && confirming === 'draw' && (
              <div className="confirm" role="group" aria-labelledby="confirm-draw">
                <p id="confirm-draw">
                  <strong>Draw names for all {countPeople(people.length)}?</strong> Everyone gets their email right away,
                  and you can't redo the draw.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={anyBusy}
                    onClick={() => run('draw', () => api.admin.drawNames(), (r) => `Names drawn. ${emailSummary(r)}`)}
                  >
                    {busy === 'draw' ? 'Drawing and sending…' : 'Draw names now'}
                  </button>
                  <button type="button" className="button button--quiet" disabled={anyBusy} onClick={() => setConfirming('')}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {status === 'drawn' && <p className="muted">Names were drawn{drawnAt ? ` on ${formatDay(drawnAt)}` : ''}.</p>}
          </Step>

          <Step number={3} current={step} title="Check everyone got their email">
            {status !== 'drawn' && <p className="muted">After the draw, this shows whose email went out.</p>}
            {status === 'drawn' && (
              <>
                <p>
                  {sentCount} of {countPeople(people.length)} got their email.
                </p>
                {unsentCount > 0 && (
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={anyBusy}
                    onClick={() => run('send-all', () => api.admin.sendEmails(), emailSummary)}
                  >
                    {busy === 'send-all' ? 'Sending…' : `Send ${plural(unsentCount, 'unsent email')}`}
                  </button>
                )}
                <p className="muted small">
                  If someone typed their address wrong, Gmail puts a bounce notice in the inbox the emails are sent from.
                </p>
              </>
            )}
          </Step>
        </ol>
      </section>

      <section className="sheet">
        <h2 className="sheet__heading">
          People <span className="sheet__count">{people.length}</span>
        </h2>
        {people.length === 0 ? (
          <p className="muted">Nobody has signed up yet. Share the link to get the first names in.</p>
        ) : (
          <ul className="roster">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                status={status}
                busy={busy}
                confirming={confirming}
                setConfirming={setConfirming}
                run={run}
              />
            ))}
          </ul>
        )}
      </section>

      {toast && (
        <div className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <p>{toast.text}</p>
          <button type="button" className="link-button link-button--light" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

function Step({ number, current, title, children }) {
  const state = number < current ? 'done' : number === current ? 'current' : 'later';
  return (
    <li className={`step step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="step__marker" aria-hidden="true">
        {state === 'done' ? '✓' : number}
      </span>
      <div className="step__body">
        <h3 className="step__title">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function ShareLink() {
  const link = signupLink();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      document.getElementById('share-link')?.select(); // clipboard blocked: select it so it's easy to copy by hand
    }
  }

  return (
    <div className="share">
      <label htmlFor="share-link" className="share__label">
        Sign-up link
      </label>
      <div className="share__row">
        <input id="share-link" className="share__input" value={link} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" className="button button--secondary button--small" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function PersonRow({ person, status, busy, confirming, setConfirming, run }) {
  const anyBusy = Boolean(busy);
  const first = firstName(person.name);
  let actions;

  if (status === 'drawn') {
    actions = (
      <>
        <EmailStatus state={person.matchEmail} />
        <button
          type="button"
          className="link-button"
          disabled={anyBusy}
          onClick={() =>
            run(
              `send:${person.id}`,
              () => api.admin.sendEmails({ id: person.id }),
              (r) => (r.sent ? `Sent ${first}'s email again.` : `${first}'s email didn't go out. Try again in a few minutes.`),
            )
          }
        >
          {busy === `send:${person.id}` ? 'Sending…' : 'Resend'}
        </button>
      </>
    );
  } else if (confirming === `remove:${person.id}`) {
    actions = (
      <>
        <button
          type="button"
          className="link-button link-button--danger"
          disabled={anyBusy}
          onClick={() =>
            run(`remove:${person.id}`, () => api.admin.removePerson({ id: person.id }), () => `Removed ${person.name}.`)
          }
        >
          {busy === `remove:${person.id}` ? 'Removing…' : `Remove ${first}`}
        </button>
        <button type="button" className="link-button" disabled={anyBusy} onClick={() => setConfirming('')}>
          Keep
        </button>
      </>
    );
  } else {
    actions = (
      <>
        {person.confirmEmail === 'failed' ? (
          <span className="tag tag--warn">Confirmation didn't send</span>
        ) : (
          person.joinedAt && <span className="roster__date">{formatDay(person.joinedAt)}</span>
        )}
        <button
          type="button"
          className="link-button"
          disabled={anyBusy}
          onClick={() => setConfirming(`remove:${person.id}`)}
        >
          Remove
        </button>
      </>
    );
  }

  return (
    <li className="roster__row">
      <div className="roster__who">
        <span className="roster__name">{person.name}</span>
        <span className="roster__email">{person.email}</span>
        {status === 'drawn' && person.matchEmailError && (
          <span className="roster__error">Gmail said: {person.matchEmailError}</span>
        )}
      </div>
      <div className="roster__actions">{actions}</div>
    </li>
  );
}

function EmailStatus({ state }) {
  if (state === 'sent') return <span className="tag tag--ok">Sent</span>;
  if (state === 'failed') return <span className="tag tag--bad">Didn't send</span>;
  return <span className="tag">Not sent yet</span>;
}
