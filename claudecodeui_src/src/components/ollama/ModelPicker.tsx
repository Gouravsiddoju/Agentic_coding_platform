/**
 * ModelPicker
 *
 * Compact inline chip for the chat input toolbar.
 * Sends a JSON control frame to the CodeMe WebSocket to switch model mid-session.
 *
 * Usage:
 *   <ModelPicker sendControl={ws.sendControl} />
 *
 * The parent must pass a sendControl(frame) function that writes to the WS.
 */
import { useState } from 'react';
import { useOllama } from '../../hooks/useOllama';

interface Props {
  /** Called with a JSON control frame to send via WebSocket */
  sendControl?: (frame: object) => void;
  /** Compact variant for toolbar use */
  compact?: boolean;
}

export function ModelPicker({ sendControl, compact = false }: Props) {
  const { status, loading, setModel } = useOllama();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function pick(model: string) {
    setSwitching(true);
    // Tell the Python WS to switch model for this session
    sendControl?.({ type: 'set_model', model });
    // Also persist via REST
    await setModel(model);
    setSwitching(false);
    setOpen(false);
  }

  if (loading || !status) return null;

  const models = status.installed_models;
  const active = status.active_model;

  return (
    <div className="relative font-sans">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={switching}
        className={[
          'flex items-center gap-1.5 rounded-lg border transition-colors',
          compact
            ? 'px-2 py-1 text-xs'
            : 'px-2.5 py-1.5 text-sm',
          status.reachable && status.model_ready
            ? 'border-[var(--mc-border,#2a2a40)] text-[var(--mc-foreground,#e2e2f0)] hover:border-[var(--mc-accent,#7c6af7)] bg-[var(--mc-surface,#17172a)]'
            : 'border-yellow-700/50 text-yellow-400 bg-yellow-900/10',
        ].join(' ')}
        title="Switch model"
      >
        {/* Model icon */}
        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
        </svg>
        <span className="max-w-[130px] truncate">{active || 'Pick model'}</span>
        <svg className="w-3 h-3 flex-shrink-0 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[200px] rounded-xl bg-[var(--mc-surface,#17172a)] border border-[var(--mc-border,#2a2a40)] shadow-2xl overflow-hidden">
          <div className="px-2 py-1.5 border-b border-[var(--mc-border,#2a2a40)]">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
              Switch model
            </span>
          </div>
          <div className="py-1 max-h-48 overflow-y-auto">
            {models.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">
                No models installed.<br />
                Run: <code className="text-yellow-300">ollama pull codellama:7b</code>
              </p>
            ) : (
              models.map(m => (
                <button
                  key={m}
                  disabled={switching}
                  onClick={() => pick(m)}
                  className={[
                    'w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors',
                    m === active
                      ? 'text-[var(--mc-accent,#7c6af7)] bg-[var(--mc-accent,#7c6af7)]/10'
                      : 'text-[var(--mc-foreground,#e2e2f0)] hover:bg-white/5',
                  ].join(' ')}
                >
                  {m === active && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                    </svg>
                  )}
                  <span className="truncate">{m}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelPicker;
