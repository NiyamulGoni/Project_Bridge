import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from './Alert';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleIdApi {
  initialize(options: {
    client_id: string;
    callback: (res: { credential: string }) => void;
    context?: 'signin' | 'signup';
    use_fedcm_for_prompt?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
  /** One Tap: the browser's own account chooser in the corner of the page. */
  prompt(): void;
  cancel(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let scriptPromise: Promise<void> | undefined;

function loadGoogleScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('Could not load Google sign-in.'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * "Sign in with Google" using Google Identity Services: the button, plus the One Tap account
 * chooser that the browser shows in the corner. Both give us the same ID token, and the server
 * verifies it and opens the normal ProjectBridge session.
 */
export function GoogleSignInButton({ text = 'signin_with' }: { text?: 'signin_with' | 'signup_with' }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !container.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          context: text === 'signup_with' ? 'signup' : 'signin',
          // Chrome now shows One Tap through FedCM, the browser's built-in account chooser.
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: false,
          itp_support: true,
          callback: async ({ credential }) => {
            setError('');
            try {
              await api('/auth/google', { body: { credential } });
              await refresh();
              navigate('/account', { replace: true });
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Google sign-in failed.');
            }
          },
        });
        window.google.accounts.id.renderButton(container.current, {
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          width: 300,
          // Chrome allows one Google sign-in request at a time, so a pending One Tap prompt
          // would swallow the click; close it first.
          click_listener: () => window.google?.accounts.id.cancel(),
        });
        window.google.accounts.id.prompt();
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
      // Leaving the sign-in page closes the chooser.
      window.google?.accounts.id.cancel();
    };
  }, [navigate, refresh, text]);

  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin">
      <div ref={container} />
      {error && <Alert tone="error">{error}</Alert>}
      <p className="divider" aria-hidden="true">
        <span>or</span>
      </p>
    </div>
  );
}
