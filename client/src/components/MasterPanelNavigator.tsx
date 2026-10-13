import { ArrowLeft, ArrowRight, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { queryClient } from '@/lib/queryClient';

export interface MasterPanelDefinition {
  label: string;
  path: string;
  aliases?: string[];
}

/** Master arrows switch only between the microphone page and the command dashboard. */
export const MASTER_PANELS: MasterPanelDefinition[] = [
  { label: 'Lexara', path: '/lexara-consent' },
  { label: 'CryptoCrawler', path: '/cryptocrawler-dashboard', aliases: ['/cryptocrawler', '/cryptocrawler-v2'] },
];

function pathOnly(location: string): string {
  return location.split('?')[0].replace(/\/$/, '') || '/';
}

function findPanelIndex(location: string): number {
  const current = pathOnly(location);
  return MASTER_PANELS.findIndex(panel =>
    panel.path === current || panel.aliases?.includes(current)
      || (panel.path === '/lexara-consent' && current.startsWith('/lexara-consent/')),
  );
}

export default function MasterPanelNavigator() {
  const [location, setLocation] = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);

  const currentIndex = useMemo(() => {
    const found = findPanelIndex(location);
    return found >= 0 ? found : 0;
  }, [location]);

  const currentPanel = MASTER_PANELS[currentIndex];

  const move = (direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + MASTER_PANELS.length) % MASTER_PANELS.length;
    setLocation(MASTER_PANELS[nextIndex].path);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      queryClient.clear();
      window.location.assign('/');
    }
  };

  return (
    <div className="sticky top-0 z-[100] overscroll-x-contain touch-pan-y border-b border-slate-700 bg-slate-950 text-slate-100 px-2 py-2 shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => move(-1)}
          className="min-h-11 min-w-11 shrink-0 touch-manipulation gap-1.5 border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
          aria-label="Previous master panel"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold">{currentPanel.label}</div>
          <div className="text-[10px] text-muted-foreground sm:text-xs">
            {currentIndex + 1} / {MASTER_PANELS.length}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => move(1)}
            className="min-h-11 min-w-11 touch-manipulation gap-1.5 border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            aria-label="Next master panel"
          >
            <span className="hidden sm:inline">Forward</span>
            <ArrowRight className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void logout()}
            disabled={loggingOut}
            className="min-h-11 min-w-11 touch-manipulation gap-1.5"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
