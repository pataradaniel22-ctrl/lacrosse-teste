/**
 * Demo mode helpers. The admin's real session token is kept aside while a demo
 * (sandbox) token is used; exiting restores it, so no new login is needed.
 */
const KEY_FLAG = 'demoMode';
const KEY_ADMIN = 'demoAdminToken';
const KEY_AS = 'demoAs';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export const isDemo = () => safe(() => localStorage.getItem(KEY_FLAG) === '1', false);
export const demoAs = () => safe(() => localStorage.getItem(KEY_AS));

export function enterDemo({ token, user_type }) {
  safe(() => {
    if (!isDemo()) localStorage.setItem(KEY_ADMIN, localStorage.getItem('token') || '');
    localStorage.setItem('token', token);
    localStorage.setItem(KEY_FLAG, '1');
    localStorage.setItem(KEY_AS, user_type);
  });
  window.location.href = user_type === 'athlete' ? '/athlete' : '/staff';
}

export function exitDemo() {
  safe(() => {
    const admin = localStorage.getItem(KEY_ADMIN);
    if (admin) localStorage.setItem('token', admin); else localStorage.removeItem('token');
    localStorage.removeItem(KEY_ADMIN);
    localStorage.removeItem(KEY_FLAG);
    localStorage.removeItem(KEY_AS);
  });
  window.location.href = '/staff/admin';
}
