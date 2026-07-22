import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function AboutTab() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6">
      {/* Logo + name + version */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/90 shadow-sm">
          <MessageSquare className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">TechOptima Opt Code</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Internal Application
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            TechOptima Opt Code Desktop Interface
          </p>
        </div>
      </div>

      {/* License */}
      <div className="border-t border-border/50 pt-4">
        <p className="text-xs text-muted-foreground/60">
          Proprietary Software - Internal Use Only
        </p>
      </div>
    </div>
  );
}
