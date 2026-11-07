/**
 * ConversationHistory
 *
 * Sidebar panel listing all saved conversations from the CodeMe Python API.
 * Emits onLoad(messages) and onNew() so the chat view can switch contexts.
 */
import { useState } from 'react';
import { useConversations, type ConversationMessage } from '../../hooks/useConversations';

interface Props {
  onLoad: (messages: ConversationMessage[], convId: string) => void;
  onNew: () => void;
  activeConvId?: string;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ConversationHistory({ onLoad, onNew, activeConvId }: Props) {
  const { conversations, loading, refresh, loadConversation, deleteConversation } = useConversations();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleLoad(id: string) {
    const msgs = await loadConversation(id);
    onLoad(msgs, id);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setDeleting(id);
    await deleteConversation(id);
    setDeleting(null);
    if (id === activeConvId) onNew();
  }

  return (
    <div className="flex flex-col h-full font-sans bg-[var(--mc-background,#0d0d14)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--mc-border,#2a2a40)]">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">History</span>
        <div className="flex gap-1">
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={onNew}
            className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
            title="New conversation"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-4 text-xs text-gray-500">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-500">No conversations yet.</div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => handleLoad(conv.id)}
              className={[
                'group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b border-[var(--mc-border,#2a2a40)]/40',
                conv.id === activeConvId
                  ? 'bg-[var(--mc-accent,#7c6af7)]/15'
                  : 'hover:bg-white/4',
              ].join(' ')}
            >
              {/* Icon */}
              <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--mc-foreground,#e2e2f0)] truncate leading-snug">
                  {conv.title}
                </p>
                <div className="flex gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-500 truncate max-w-[80px]">{conv.model}</span>
                  <span className="text-[10px] text-gray-600">{timeAgo(conv.updated_at)}</span>
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={e => handleDelete(e, conv.id)}
                disabled={deleting === conv.id}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ConversationHistory;
