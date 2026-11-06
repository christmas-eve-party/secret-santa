import { useEffect, useState } from 'react';
import { api } from '../api.js';
import DrawBox from '../components/DrawBox.jsx';
import { friendlyError } from '../errors.js';
import { suggestEmail, validateSignup } from '../validate.js';

const EMPTY_FORM = { name: '', email: '', email2: '' };
const DROP_MS = 700; // matches the slip-drop animation in styles.css
const firstName = (name) => name.split(' ')[0];

export default function SignupPage() {
  const [info, setInfo] = useState(null); // { status, event } from the server
  const [loadError, setLoadError] = useState('');
  const [namesDropped, setNamesDropped] = useState(0);

  useEffect(() => {
    let active = true;
    api.getStatus().then(
      (result) => active && setInfo(result),
      (error) => active && setLoadError(friendlyError(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  const event = info?.event;
  const status = info?.status;

  let slip;
  if (loadError) {
    slip = (
      <section className="slip">
        <p className="message message--error" role="alert">
          {loadError}
        </p>
      </section>
    );
  } else if (!info) {
    slip = (
      <section className="slip slip--loading" aria-busy="true">
        <p className="muted">Loading…</p>
      </section>
    );
  } else if (status === 'open') {
    slip = (
      <SignupSlip
        event={event}
        onClosed={() => setInfo({ ...info, status: 'closed' })}
        onDropped={() => setNamesDropped((n) => n + 1)}
      />
    );
  } else {
    slip = <ClosedSlip status={status} event={event} />;
  }

  return (
    <main className="signup">
      <header className="signup__intro">
        <h1 className="marker signup__title">Secret Santa</h1>
        {event && (
          <>
            <p className="signup__when">
              {event.partyName}: {event.when}.
            </p>
            <p className="signup__how">
              Spend up to {event.budget}. Once names are drawn, we'll email you the person you're shopping for.
            </p>
          </>
        )}
      </header>

      {slip}
      <DrawBox sealed={Boolean(info) && status !== 'open'} bump={namesDropped} />

      {event && (
        <footer className="signup__footer">
          {event.note && <p>{event.note}</p>}
          <p>Questions? Ask {event.organizer}.</p>
        </footer>
      )}
    </main>
  );
}

function SignupSlip({ event, onClosed, onDropped }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [suggestion, setSuggestion] = useState(null);
  const [phase, setPhase] = useState('form'); // form -> sending -> dropping -> done
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);

  const edit = (field) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((errs) => ({ ...errs, [field]: undefined }));
    if (field === 'email') setSuggestion(null);
  };

  function applySuggestion() {
    setForm((f) => ({ ...f, email: suggestion, email2: suggestion }));
    setErrors((errs) => ({ ...errs, email: undefined, email2: undefined }));
    setSuggestion(null);
  }

  async function submit(e) {
    e.preventDefault();
    const problems = validateSignup(form);
    setErrors(problems);
    const firstProblem = Object.keys(problems)[0];
    if (firstProblem) {
      document.getElementById(firstProblem)?.focus();
      return;
    }

    setPhase('sending');
    setSubmitError('');
    try {
      const response = await api.signUp({ name: form.name, email: form.email });
      setResult({ ...response, email: form.email.trim().toLowerCase() });
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setPhase('dropping');
      setTimeout(
        () => {
          setPhase('done');
          onDropped();
        },
        reduceMotion ? 0 : DROP_MS,
      );
    } catch (error) {
      setPhase('form');
      if (error?.code === 'already-exists') setErrors({ email: error.message });
      else if (error?.code === 'failed-precondition') onClosed();
      else setSubmitError(friendlyError(error));
    }
  }

  if (phase === 'done') {
    return (
      <section className="slip slip--done" aria-live="polite">
        <h2 className="marker slip__done-title">You're in, {firstName(result.name)}!</h2>
        {result.confirmation === 'sent' && (
          <p>
            We sent a confirmation to <strong>{result.email}</strong>. When names are drawn, you'll get another email
            with the person you're shopping for.
          </p>
        )}
        {result.confirmation === 'failed' && (
          <p>
            We couldn't send a confirmation to <strong>{result.email}</strong>. If that address looks wrong, tell{' '}
            {event.organizer}.
          </p>
        )}
        {result.confirmation === 'off' && (
          <p>
            When names are drawn, we'll email <strong>{result.email}</strong> with the person you're shopping for.
          </p>
        )}
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setForm(EMPTY_FORM);
            setResult(null);
            setPhase('form');
          }}
        >
          Sign up someone else
        </button>
      </section>
    );
  }

  const busy = phase !== 'form';
  return (
    <form
      className={phase === 'dropping' ? 'slip slip--dropping' : 'slip'}
      onSubmit={submit}
      noValidate
      aria-busy={busy}
    >
      <div className={errors.name ? 'field field--error' : 'field'}>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          className="name-input"
          value={form.name}
          onChange={edit('name')}
          autoComplete="name"
          autoCapitalize="words"
          maxLength={50}
          disabled={busy}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <p className="field__error" id="name-error">
            {errors.name}
          </p>
        )}
      </div>

      <div className={errors.email ? 'field field--error' : 'field'}>
        <label htmlFor="email">Your email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          value={form.email}
          onChange={edit('email')}
          onBlur={() => setSuggestion(suggestEmail(form.email.trim()))}
          disabled={busy}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={['email-help', errors.email && 'email-error', suggestion && 'email-suggestion']
            .filter(Boolean)
            .join(' ')}
        />
        <p className="field__help" id="email-help">
          Your match gets sent here, so double-check it.
        </p>
        {suggestion && (
          <p className="field__suggestion" id="email-suggestion">
            Did you mean{' '}
            <button type="button" className="link-button link-button--inline" onClick={applySuggestion}>
              {suggestion}
            </button>
            ?
          </p>
        )}
        {errors.email && (
          <p className="field__error" id="email-error">
            {errors.email}
          </p>
        )}
      </div>

      <div className={errors.email2 ? 'field field--error' : 'field'}>
        <label htmlFor="email2">Email again</label>
        <input
          id="email2"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          value={form.email2}
          onChange={edit('email2')}
          disabled={busy}
          aria-invalid={Boolean(errors.email2)}
          aria-describedby={errors.email2 ? 'email2-error' : undefined}
        />
        {errors.email2 && (
          <p className="field__error" id="email2-error">
            {errors.email2}
          </p>
        )}
      </div>

      {submitError && (
        <p className="message message--error" role="alert">
          {submitError}
        </p>
      )}

      <button type="submit" className="button button--primary button--full" disabled={busy}>
        {busy ? 'Putting your name in…' : 'Put my name in'}
      </button>
    </form>
  );
}

function ClosedSlip({ status, event }) {
  if (status === 'drawn') {
    return (
      <section className="slip">
        <h2 className="slip__heading">Names have been drawn</h2>
        <p>
          Check your email for the person you're shopping for. Can't find it? Look in spam, or ask {event.organizer} to
          resend it.
        </p>
      </section>
    );
  }
  return (
    <section className="slip">
      <h2 className="slip__heading">Sign-ups are closed</h2>
      <p>Names haven't been drawn yet. If you still want in, ask {event.organizer}.</p>
    </section>
  );
}
