/**
 * useOllama — talks to the CodeMe Python API (/api/status, /api/models, /api/models/set)
 *
 * Polls every 15 s so the health badge stays live without hammering Ollama.
 */
import { useCallback, useEffect, useState } from 'react';

const CODEME_API = import.meta.env.VITE_CODEME_API_URL || 'http://localhost:8007';

export interface OllamaStatus {
  reachable: boolean;
  active_model: string;
  installed_models: string[];
  model_ready: boolean;
  embed_model: string;
  embed_model_ready: boolean;
  url: string;
}

export interface UseOllamaResult {
  status: OllamaStatus | null;
  loading: boolean;
  error: string | null;
  setModel: (model: string) => Promise<void>;
  refresh: () => void;
}

const INITIAL: OllamaStatus = {
  reachable: false,
  active_model: '',
  installed_models: [],
  model_ready: false,
  embed_model: '',
  embed_model_ready: false,
  url: 'http://localhost:11434',
};

export function useOllama(): UseOllamaResult {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${CODEME_API}/api/status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data.ollama ?? INITIAL);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(prev => prev ?? { ...INITIAL });
    } finally {
      setLoading(false);
    }
  }, []);

  const setModel = useCallback(async (model: string) => {
    await fetch(`${CODEME_API}/api/models/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { status, loading, error, setModel, refresh };
}
