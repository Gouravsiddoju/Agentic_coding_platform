import { Settings, LogOut } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useAuth } from '../../../auth/context/AuthContext';

type SidebarFooterProps = {
  currentVersion: string;
  onShowSettings: () => void;
  t: TFunction;
  updateAvailable?: boolean;
  releaseInfo?: any;
  latestVersion?: string | null;
  onShowVersionModal?: () => void;
};

export default function SidebarFooter({
  currentVersion,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  const { logout } = useAuth();

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      <div className="nav-divider" />

      {/* Desktop settings & logout */}
      <div className="hidden px-2 py-1.5 md:flex md:gap-1">
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
          title={t('actions.settings')}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={logout}
          title={t('common:logout', 'Log out')}
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="text-sm">{t('common:logout', 'Log out')}</span>
        </button>
      </div>

      {/* Desktop version brand line */}
      <div className="hidden px-3 py-2 text-center md:block">
        <span className="text-[10px] text-muted-foreground/40">
          TechOptima Opt Code v{currentVersion} – Internal
        </span>
      </div>

      {/* Mobile settings & logout */}
      <div className="flex gap-2 px-3 pb-3 pt-2 md:hidden">
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-muted/40 px-3.5 py-2 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
            <Settings className="h-4 w-4 text-muted-foreground" />
          </div>
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive/5 px-3.5 py-2 text-destructive transition-all hover:bg-destructive/10 active:scale-[0.98]"
          onClick={logout}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
            <LogOut className="h-4 w-4" />
          </div>
        </button>
      </div>
    </div>
  );
}
