import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

// Watches the service worker for a new version and prompts the user to update.
// A new SW waits (see public/service-worker.js); when detected we show a
// persistent toast with an "Update now" action that activates it and reloads.
export default function UpdatePrompt() {
  const promptedRef = useRef(false);
  const reloadingRef = useRef(false);
  const userInitiatedRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const showUpdateToast = (worker) => {
      if (promptedRef.current) return;
      promptedRef.current = true;
      toast('A new version of the app is available', {
        description: 'Tap "Update now" to load the latest version. Or just close and reopen the app.',
        icon: <RefreshCw className="w-4 h-4 text-primary" />,
        duration: Infinity,
        important: true,
        action: {
          label: 'Update now',
          onClick: () => { userInitiatedRef.current = true; worker.postMessage({ type: 'SKIP_WAITING' }); },
        },
      });
    };

    const watch = (reg) => {
      if (!reg) return;
      // Already a worker waiting (installed while app was open, or from a prior visit)
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateToast(reg.waiting);
      }
      // A new worker starts installing
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(installing);
          }
        });
      });
    };

    let intervalId;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      watch(reg);
      // Check for a new version periodically and when the tab regains focus
      intervalId = setInterval(() => reg.update().catch(() => {}), 60 * 1000);
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update().catch(() => {}));
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // Reload once the user-approved new SW takes control (guard against first-install reloads)
    const onControllerChange = () => {
      if (!userInitiatedRef.current || reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
