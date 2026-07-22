/**
 * OPTCode Intent Router — TypeScript Port
 * Classifies user input into intents and routes to the appropriate agent.
 * 
 * Intents: CREATE, IMPLEMENT, FIX, REFACTOR, TEST, REVIEW, CHAT
 */

import { LLMService } from './llm-service.js';
import { extractJSON } from './json-parser.js';

export type Intent = 'CREATE' | 'IMPLEMENT' | 'FIX' | 'REFACTOR' | 'TEST' | 'REVIEW' | 'CHAT';

export interface RouteResult {
  intent: Intent;
  target: string;
}

const VALID_INTENTS = new Set<Intent>(['CREATE', 'IMPLEMENT', 'FIX', 'REFACTOR', 'TEST', 'REVIEW', 'CHAT']);

export class IntentRouter {

  static async routeIntent(userInput: string, history?: { role: string; content: string }[]): Promise<RouteResult> {
    // 1. Deterministic Slash Command Parsing (Bypass LLM completely for 100% accuracy)
    const trimmedInput = userInput.trim();
    const slashCommands: Record<string, Intent> = {
      '/create': 'CREATE',
      '/implement': 'IMPLEMENT',
      '/fix': 'FIX',
      '/refactor': 'REFACTOR',
      '/test': 'TEST',
      '/review': 'REVIEW',
      '/chat': 'CHAT',
      'proceed': 'IMPLEMENT',
      'proceed!': 'IMPLEMENT'
    };

    for (const [cmd, intent] of Object.entries(slashCommands)) {
      if (trimmedInput.toLowerCase().startsWith(cmd)) {
        const target = trimmedInput.slice(cmd.length).trim() || 'execute previous instructions';
        return { intent, target };
      }
    }

    // 2. Fallback to LLM Heuristic Classification
    const systemPrompt = `You are an Intent Router for an autonomous Software Engineering Agent.
Your job is to analyze the CURRENT USER INPUT and classify their intent into exactly one of these categories:

1. "CREATE": Scaffold or create an entire project from scratch.
2. "IMPLEMENT": Build, add, or modify features within an EXISTING project. ANY request to change how the app looks, feels, or works is an IMPLEMENT intent (e.g. "make it blue", "use tailwind", "the website is not good", "do it yourself", "make changes to the frontend"). Even if phrased as a complaint or general statement, if it implies changing code, route to IMPLEMENT.
3. "FIX": Debug, fix, or resolve a broken feature, error, or failing tests (e.g. "Fix the bug", "Tests are failing").
4. "REFACTOR": Restructure, clean up, or improve existing code without changing behavior.
5. "TEST": Explicitly WRITE, GENERATE, or CREATE new test files.
6. "REVIEW": Request a code review, analysis, or quality assessment (e.g. "Analyze this project", "Review the code").
7. "CHAT": PURELY conversational questions that DO NOT require writing code or changing the app (e.g. "how does this work?", "what does this file do?", "test the project").

EXAMPLES:
Input: "build a new React app" -> {"intent": "CREATE", "target": "build a new React app"}
Input: "add stripe integration" -> {"intent": "IMPLEMENT", "target": "add stripe integration"}
Input: "implement them" -> {"intent": "IMPLEMENT", "target": "implement the requested features"}
Input: "do it yourself" -> {"intent": "IMPLEMENT", "target": "implement the changes yourself"}
Input: "the website is not good use the colors and animation from css and tailwind css!" -> {"intent": "IMPLEMENT", "target": "improve website using colors, animation, and tailwind css"}
Input: "fix the null pointer exception" -> {"intent": "FIX", "target": "fix the null pointer exception"}
Input: "test the project" -> {"intent": "CHAT", "target": "run the tests for the project"}
Input: "analyze the project" -> {"intent": "REVIEW", "target": "analyze the project"}

Return ONLY a valid JSON object. No markdown, no explanation:
{
  "intent": "CREATE" | "IMPLEMENT" | "FIX" | "REFACTOR" | "TEST" | "REVIEW" | "CHAT",
  "target": "The exact core instruction extracted from the current user input"
}`;

    let historyContext = '';
    if (history && history.length > 0) {
      const recentHistory = history.slice(-4);
      historyContext = '\n\n--- CONVERSATION HISTORY ---\n' + recentHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    }

    const finalPrompt = `--- CURRENT USER INPUT ---\n${userInput}${historyContext}\n\nClassify the CURRENT USER INPUT.`;

    try {
      const response = await LLMService.generateCompletion(finalPrompt, systemPrompt);
      
      const data = extractJSON<{ intent: string; target: string }>(response, 'intent');
      
      if (!data) {
        console.warn(`[IntentRouter] Failed to parse response: ${response.slice(0, 200)}`);
        return { intent: 'CHAT', target: userInput };
      }

      // Normalize the intent value
      const rawIntent = (data.intent ?? 'CHAT').trim().toUpperCase() as Intent;
      const intent: Intent = VALID_INTENTS.has(rawIntent) ? rawIntent : 'CHAT';
      
      return {
        intent,
        target: data.target ?? userInput,
      };
    } catch (e) {
      console.error('[IntentRouter] Error during routing:', e);
      // Fallback to CHAT if routing fails
      return { intent: 'CHAT', target: userInput };
    }
  }
}
