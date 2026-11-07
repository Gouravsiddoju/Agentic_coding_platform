/**
 * OllamaStatusWidget
 *
 * Shows a compact health badge + model picker.
 * Green dot = Ollama running, red = down, yellow = model not installed.
 *
 * Usage: drop anywhere in the sidebar or header.
 *   <OllamaStatusWidget />
 */
import { useState } from 'react';
import { useOllama } from '../../hooks/useOllama';

export function OllamaStatusWidget() {
  const { status, loading, error, setModel } = useOllama();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const dot = loading
    ? 'bg-yellow-400'
    : !status?.reachable
    ? 'bg-red-500'
    : !status.model_ready
    ? 'bg-yellow-400'
    : 'bg-green-400';

  const label = loading
    ? 'Connecting…'
    : !status?.reachable
    ? 'Ollama offline'
    : status.active_model || 'No model';

  async function pick(model: string) {
    setSwitching(true);
    await setModel(model);
    setSwitching(false);
    setOpen(false);
  }

  return (
    <div className="relative select-none font-sans">
      {/* Badge */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--mc-surface,#17172a)] border border-[var(--mc-border,#2a2a40)] hover:border-[var(--mc-accent,#7c6af7)] transition-colors text-sm"
        title="Ollama status — click to switch model"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${dot}`} />
        <span className="text-[var(--mc-foreground,#e2e2f0)] max-w-[140px] truncate">
          {label}
        </span>
        <svg className="w-3 h-3 text-gray-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-50 min-w-[220px] rounded-xl bg-[var(--mc-surface,#17172a)] border border-[var(--mc-border,#2a2a40)] shadow-2xl overflow-hidden font-sans">
          {/* Header */}
          <div className="px-3 py-2 border-b border-[var(--mc-border,#2a2a40)]">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Ollama</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{status?.url}</p>
          </div>

          {!status?.reachable ? (
            <div className="px-3 py-3 text-xs text-red-400">
              Ollama is not running.<br />
              <code className="text-red-300">ollama serve</code>
            </div>
          ) : status?.installed_models.length === 0 ? (
            <div className="px-3 py-3 text-xs text-yellow-400">
              No models installed.<br />
              <code className="text-yellow-300">ollama pull codellama:7b</code>
            </div>
          ) : (
            <div className="py-1 max-h-56 overflow-y-auto">
              {status.installed_models.map(m => (
                <button
                  key={m}
                  disabled={switching}
                  onClick={() => pick(m)}
                  className={[
                    'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                    m === status.active_model
                      ? 'bg-[var(--mc-accent,#7c6af7)]/20 text-[var(--mc-accent,#7c6af7)]'
                      : 'text-[var(--mc-foreground,#e2e2f0)] hover:bg-white/5',
                  ].join(' ')}
                >
                  {m === status.active_model && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                    </svg>
                  )}
                  <span className="truncate">{m}</span>
                </button>
              ))}
            </div>
          )}

          {/* Embed model info */}
          {status?.reachable && (
            <div className="px-3 py-2 border-t border-[var(--mc-border,#2a2a40)] text-[11px] text-gray-500">
              Embed: <span className={status.embed_model_ready ? 'text-green-400' : 'text-yellow-400'}>
                {status.embed_model || '—'}
              </span>
              {!status.embed_model_ready && (
                <span className="ml-1 text-yellow-500">(not installed)</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default OllamaStatusWidget;
