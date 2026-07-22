/**
 * OPTCode Intent Router — TypeScript Port
 * Classifies user input into CREATE, IMPLEMENT, FIX, or CHAT intents.
 */

import { LLMService } from './llm-service';

export type Intent = 'CREATE' | 'IMPLEMENT' | 'FIX' | 'CHAT';

export interface RouteResult {
  intent: Intent;
  target: string;
}

export class IntentRouter {

  static async routeIntent(userInput: string): Promise<RouteResult> {
    const systemPrompt = `You are an Intent Router for an autonomous Software Engineering Agent.
Analyze the user's input and classify their intent into one of four categories:
1. "CREATE": The user is asking to scaffold or create an entire project from scratch (e.g. "Create a new React project", "Build a FastAPI backend from scratch").
2. "IMPLEMENT": The user is asking to build or modify code within an EXISTING project (e.g. "Create a login page", "Add a button to the header").
3. "FIX": The user is asking to debug or fix a broken feature/tests (e.g. "Fix the login bug", "Tests are failing").
4. "CHAT": The user is asking a general question, asking for an explanation, or conversing without wanting you to write code autonomously.

Return ONLY a valid JSON object in the following format:
{
    "intent": "CREATE" | "IMPLEMENT" | "FIX" | "CHAT",
    "target": "The exact core instruction extracted from the user's input, removing conversational fluff."
}`;

    try {
      let response = await LLMService.generateCompletion(userInput, systemPrompt);
      
      // Clean up markdown blocks
      response = response.trim();
      if (response.startsWith('```json')) response = response.slice(7);
      if (response.startsWith('```')) response = response.slice(3);
      if (response.endsWith('```')) response = response.slice(0, -3);

      const data = JSON.parse(response.trim());
      return {
        intent: data.intent ?? 'CHAT',
        target: data.target ?? userInput,
      };
    } catch {
      // Fallback to CHAT if routing fails
      return { intent: 'CHAT', target: userInput };
    }
  }
}
