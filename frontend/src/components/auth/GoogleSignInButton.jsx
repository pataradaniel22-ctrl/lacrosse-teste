import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      s.onload = resolve;
      s.onerror = () => { scriptPromise = null; reject(new Error('Google script failed to load')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * "Sign in with Google" button. Renders nothing when the server has no
 * GOOGLE_CLIENT_ID configured, so the login page stays as before.
 */
export default function GoogleSignInButton({ onCredential, disabled }) {
  const box = useRef(null);
  const cb = useRef(onCredential);
  const [clientId, setClientId] = useState(null);
  cb.current = onCredential;

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/auth/google/config`)
      .then((r) => { if (alive && r.data?.enabled) setClientId(r.data.client_id); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    loadGoogleScript().then(() => {
      if (!alive || !box.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => resp?.credential && cb.current(resp.credential),
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      const width = Math.min(400, Math.max(200, box.current.offsetWidth || 320));
      window.google.accounts.id.renderButton(box.current, {
        theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'signin_with', width,
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="space-y-4" data-testid="google-signin">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-white/10" />or<div className="h-px flex-1 bg-white/10" />
      </div>
      <div
        ref={box}
        className={`flex justify-center min-h-[44px] ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        data-testid="google-signin-btn"
      />
    </div>
  );
}
