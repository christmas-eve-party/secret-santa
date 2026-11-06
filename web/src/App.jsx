import { useEffect, useState } from 'react';
import { api } from './api.js';
import DemoBar from './demo/DemoBar.jsx';
import AdminPage from './pages/AdminPage.jsx';
import SignupPage from './pages/SignupPage.jsx';

const isDemo = import.meta.env.MODE === 'demo';

// Two pages: the sign-up page at /, and the admin page at /#admin (/#/admin works too).
const currentRoute = () => (window.location.hash.replace(/^#\/?/, '') === 'admin' ? 'admin' : 'signup');

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [resets, setResets] = useState(0);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Braces matter: newer browsers return a value from scrollTo, and React would treat it as a cleanup function.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const Page = route === 'admin' ? AdminPage : SignupPage;
  return (
    <>
      <Page key={resets} />
      {isDemo && (
        <DemoBar
          route={route}
          onReset={() => {
            api.demo.reset();
            setResets((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
