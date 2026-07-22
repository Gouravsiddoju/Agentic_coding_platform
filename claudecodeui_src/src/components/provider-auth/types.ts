import type { LLMProvider } from '../../types/app';

export type ProviderAuthStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
  loading: boolean;
};

export type ProviderAuthStatusMap = Record<LLMProvider, ProviderAuthStatus>;

export const CLI_PROVIDERS: LLMProvider[] = ['optcode'];

export const PROVIDER_AUTH_STATUS_ENDPOINTS: Record<LLMProvider, string> = {
  optcode: '/api/providers/optcode/auth/status',
  
  
  
};

export const createInitialProviderAuthStatusMap = (loading = true): ProviderAuthStatusMap => ({
    optcode: { authenticated: false, email: null, method: null, error: null, loading },
});
