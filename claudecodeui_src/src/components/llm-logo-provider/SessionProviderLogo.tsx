import type { LLMProvider } from '../../types/app';
import OptCodeLogo from './OptCodeLogo';
import CodexLogo from './CodexLogo';
import CursorLogo from './CursorLogo';
import GeminiLogo from './GeminiLogo';

type SessionProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'optcode',
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  if (provider === 'cursor') {
    return <CursorLogo className={className} />;
  }

  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  if (provider === 'gemini') {
    return <GeminiLogo className={className} />;
  }

  if (provider === 'optcode') {
    return <OptCodeLogo className={className} />;
  }

  return <OptCodeLogo className={className} />;
}
