/**
 * OPTCode LLM Service — TypeScript Port
 * Connects to OptGPT-4:latest running on the company's private server.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, string>;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

const API_URL = 'http://192.168.1.117:8006/api/generate';
const CHAT_API_URL = 'http://192.168.1.117:8006/api/chat';
const MODEL_NAME = 'OptGPT-4:latest';

export class LLMService {

  /**
   * Simple text completion. Fire a prompt, get text back.
   */
  static async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const payload: Record<string, unknown> = {
      model: MODEL_NAME,
      prompt,
      stream: false,
      options: { num_ctx: 32768 },
    };
    if (systemPrompt) payload.system = systemPrompt;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.response ?? '';
    } catch (e) {
      return `Error: Unable to reach LLM at ${API_URL}. Details: ${e}`;
    }
  }

  /**
   * Multi-turn chat. Returns just the text content.
   */
  static async chat(messages: ChatMessage[]): Promise<string> {
    const payload = {
      model: MODEL_NAME,
      messages,
      stream: false,
      options: { num_ctx: 32768 },
    };

    try {
      const res = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.message?.content ?? '';
    } catch (e) {
      return `Error: Unable to reach LLM at ${CHAT_API_URL}. Details: ${e}`;
    }
  }

  /**
   * Agent chat with tool calling. Returns the full message object
   * so the caller can inspect tool_calls.
   */
  static async agentChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatMessage> {
    const payload: Record<string, unknown> = {
      model: MODEL_NAME,
      messages,
      stream: false,
      options: { num_ctx: 32768 },
    };
    if (tools) payload.tools = tools;

    try {
      const res = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.message ?? { role: 'assistant', content: '' };
    } catch (e) {
      return { role: 'assistant', content: `Error reaching API: ${e}` };
    }
  }
}
