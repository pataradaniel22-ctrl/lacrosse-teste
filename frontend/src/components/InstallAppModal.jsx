import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Smartphone, Share, Plus, MoreVertical, Download, CheckCircle2 } from 'lucide-react';

const STORAGE_KEY = 'bl_hide_install_tutorial';

export default function InstallAppModal() {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    const hidden = localStorage.getItem(STORAGE_KEY) === 'true';
    if (!hidden) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const handleClose = () => {
    if (dontShow) localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  };

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const defaultTab = isIOS ? 'ios' : 'android';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md" data-testid="install-app-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-primary" />
            </div>
            Install the app
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-1">
          Add Brasil Lacrosse to your phone's home screen to open it like an app, in full screen and with quick access.
        </p>

        <Tabs defaultValue={defaultTab} className="mt-2">
          <TabsList className="grid grid-cols-2 bg-muted/50">
            <TabsTrigger value="android" data-testid="install-tab-android">Android</TabsTrigger>
            <TabsTrigger value="ios" data-testid="install-tab-ios">iPhone (iOS)</TabsTrigger>
          </TabsList>

          {/* Android */}
          <TabsContent value="android" className="mt-3">
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">1</span>
                <p className="text-sm">Open this site in <strong>Google Chrome</strong>.</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <p className="text-sm flex items-center gap-1.5 flex-wrap">
                  Tap the menu <MoreVertical className="w-4 h-4 inline" /> (3 dots) in the top-right corner.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">3</span>
                <p className="text-sm flex items-center gap-1.5 flex-wrap">
                  Select <strong>"Add to Home screen"</strong> <Plus className="w-4 h-4 inline" /> (or "Install app").
                </p>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                <p className="text-sm">Confirm and you're done! The icon will appear on your home screen.</p>
              </li>
            </ol>
          </TabsContent>

          {/* iOS */}
          <TabsContent value="ios" className="mt-3">
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">1</span>
                <p className="text-sm">Open this site in <strong>Safari</strong> (it won't work in other browsers on iPhone).</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <p className="text-sm flex items-center gap-1.5 flex-wrap">
                  Tap the <strong>Share</strong> button <Share className="w-4 h-4 inline" /> in the bottom bar.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">3</span>
                <p className="text-sm flex items-center gap-1.5 flex-wrap">
                  Choose <strong>"Add to Home Screen"</strong> <Plus className="w-4 h-4 inline" />.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                <p className="text-sm">Tap <strong>"Add"</strong> and the app will appear on your home screen.</p>
              </li>
            </ol>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col sm:flex-col gap-3 mt-2">
          <label className="flex items-center gap-2 cursor-pointer self-start" data-testid="install-dont-show-label">
            <Checkbox
              checked={dontShow}
              onCheckedChange={(v) => setDontShow(!!v)}
              data-testid="install-dont-show-checkbox"
            />
            <span className="text-sm text-muted-foreground">Don't show this message again</span>
          </label>
          <Button onClick={handleClose} className="w-full" data-testid="install-close-btn">
            <Download className="w-4 h-4 mr-2" /> Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
