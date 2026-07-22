/**
 * OPTCode LLM Service — TypeScript Port
 * Connects to OptGPT-4:latest running on the company's private server.
 * 
 * Features:
 * - Retry logic with exponential backoff
 * - Proper error throwing (no silent error strings)
 * - Configurable API URL
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, string> | string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export class LLMServiceError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'LLMServiceError';
  }
}

const API_URL = process.env.OPTCODE_API_URL || 'http://192.168.1.117:8006';
const GENERATE_URL = `${API_URL}/api/generate`;
const CHAT_URL = `${API_URL}/api/chat`;
const MODEL_NAME = process.env.OPTCODE_MODEL || 'gemma4:31b-it-qat';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Sleep for the given milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[LLMService] ${label} attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw new LLMServiceError(`${label} failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Strip <think>...</think> blocks from LLM responses to prevent JSON/file corruption,
 * but extract the reasoning to display it in the UI.
 */
function extractAndStripThinkBlocks(text: string): { content: string, reasoning: string } {
  if (!text) return { content: '', reasoning: '' };
  
  let reasoning = '';
  const content = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, p1) => {
    reasoning += p1.trim() + '\n\n';
    return '';
  }).trim();
  
  return { content, reasoning: reasoning.trim() };
}

export class LLMService {

  /**
   * Simple text completion. Fire a prompt, get text back.
   * Throws LLMServiceError on failure.
   */
  static async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    return withRetry(async () => {
      const payload: Record<string, unknown> = {
        model: MODEL_NAME,
        prompt,
        stream: false,
      };
      if (systemPrompt) payload.system = systemPrompt;

      const res = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });

      if (!res.ok) {
        let errBody = '';
        try { errBody = await res.text(); } catch(e) {}
        throw new LLMServiceError(`HTTP ${res.status}: ${res.statusText} - ${errBody}`, res.status);
      }

      const data: any = await res.json();
      const response = data.response ?? '';
      if (!response) {
        console.warn('[LLMService] generateCompletion returned empty response');
      }
      return extractAndStripThinkBlocks(response).content;
    }, 'generateCompletion');
  }

  /**
   * Multi-turn chat. Returns just the text content.
   * Throws LLMServiceError on failure.
   */
  static async chat(messages: ChatMessage[]): Promise<string> {
    return withRetry(async () => {
      const payload = {
        model: MODEL_NAME,
        messages,
        stream: false,
      };

      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });

      if (!res.ok) {
        throw new LLMServiceError(`HTTP ${res.status}: ${res.statusText}`, res.status);
      }

      const data: any = await res.json();
      const content = data.message?.content ?? '';
      return extractAndStripThinkBlocks(content).content;
    }, 'chat');
  }

  /**
   * Agent chat with tool calling. Returns the full message object
   * so the caller can inspect tool_calls.
   * Throws LLMServiceError on failure.
   */
  static async agentChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatMessage> {
    return withRetry(async () => {
      const payload: Record<string, unknown> = {
        model: MODEL_NAME,
        messages,
        stream: false,
      };
      if (tools) payload.tools = tools;

      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });

      if (!res.ok) {
        throw new LLMServiceError(`HTTP ${res.status}: ${res.statusText}`, res.status);
      }

      const data: any = await res.json();
      const message = data.message ?? { role: 'assistant', content: '' };
      if (message.content) {
        const extracted = extractAndStripThinkBlocks(message.content);
        message.content = extracted.content;
        if (extracted.reasoning) {
            (message as any).reasoning = extracted.reasoning;
        }
      }
      return message;
    }, 'agentChat');
  }
}
