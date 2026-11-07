/**
 * useConversations — manages conversation history via the CodeMe Python API
 */
import { useCallback, useEffect, useState } from 'react';

const CODEME_API = import.meta.env.VITE_CODEME_API_URL || 'http://localhost:8007';

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface UseConversationsResult {
  conversations: ConversationSummary[];
  loading: boolean;
  refresh: () => void;
  loadConversation: (id: string) => Promise<ConversationMessage[]>;
  deleteConversation: (id: string) => Promise<void>;
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${CODEME_API}/api/conversations`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {
      // Server may not be running yet — fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (id: string): Promise<ConversationMessage[]> => {
    const res = await fetch(`${CODEME_API}/api/conversations/${id}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages ?? [];
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await fetch(`${CODEME_API}/api/conversations/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { conversations, loading, refresh, loadConversation, deleteConversation };
}
