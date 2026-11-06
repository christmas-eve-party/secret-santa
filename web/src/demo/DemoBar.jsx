// Only in the demo build: jump between the two pages, or start over.
export default function DemoBar({ route, onReset }) {
  return (
    <nav className="demo-bar" aria-label="Demo controls">
      <p className="demo-bar__note">Demo: nothing is saved or emailed.</p>
      <div className="demo-bar__links">
        <a href="#signup" aria-current={route === 'signup' ? 'page' : undefined}>
          Sign-up page
        </a>
        <a href="#admin" aria-current={route === 'admin' ? 'page' : undefined}>
          Admin page
        </a>
        <button type="button" onClick={onReset}>
          Start over
        </button>
      </div>
    </nav>
  );
}
