import { ChatMessage, ModelConfig } from '../types';
import { readSSE } from './stream';
import { authHeaders } from './api';

export const LLM_AUTO_ATTEMPTS = 3;

export function isRetryableLLMError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  if (!msg) return false;
  if (msg.includes('401') || msg.includes('403') || msg.includes('invalid api')) return false;
  // Client/server gate errors — retrying will not help.
  if (
    msg.includes('accept the requirement') ||
    msg.includes('associate at least one') ||
    msg.includes('pick a sub-requirement') ||
    msg.includes('requirement document required')
  ) {
    return false;
  }
  return (
    msg.includes('timeout') ||
    msg.includes('deadline exceeded') ||
    msg.includes('client.timeout') ||
    msg.includes('429') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('econnreset') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('empty model') ||
    msg.includes('stream ended') ||
    msg.includes('eof')
  );
}

export interface RepoRef {
  name: string;
  path: string;
  defaultBranch: string;
}

export interface ChatRequestParams {
  prompt: string;
  messages: ChatMessage[];
  modelConfig?: ModelConfig;
  issueTitle?: string;
  issueDescription?: string;
  associatedRepos?: RepoRef[];
  generateSpec?: boolean;
  projectId?: string;
  issueId?: string;
  resumePartial?: string;
  freshStart?: boolean;
  resume?: boolean;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
  onStatus?: (msg: string) => void;
}

export async function sendLLMChat(params: ChatRequestParams): Promise<string> {
  const res = await fetch('/api/chat?stream=1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    body: JSON.stringify({
      prompt: params.prompt,
      messages: params.messages,
      issueTitle: params.issueTitle,
      issueDescription: params.issueDescription,
      associatedRepos: params.associatedRepos || [],
      generateSpec: params.generateSpec,
      projectId: params.projectId,
      issueId: params.issueId,
      resumePartial: params.resumePartial,
      freshStart: params.freshStart,
      resume: params.resume,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error || `HTTP ${res.status}: Failed to receive response from AI model.`
    );
  }

  let text = '';
  let streamError: string | null = null;

  await readSSE(res, (ev) => {
    if (ev.type === 'delta' && ev.text) {
      text += ev.text;
      params.onDelta?.(ev.text);
    } else if (ev.type === 'status' && ev.message) {
      params.onStatus?.(ev.message);
    } else if (ev.type === 'error') {
      streamError = ev.error || 'stream error';
    } else if (ev.type === 'done' && typeof ev.text === 'string') {
      text = ev.text;
    }
  });

  if (streamError) throw new Error(streamError);
  if (!text) throw new Error('Empty model response');
  return text;
}

export async function testOpenAPIConnection(config: {
  openAIBaseUrl: string;
  openAIApiKey: string;
  openAIModel: string;
  /** When key is blank, server uses this project's stored custom key (if any). */
  projectId?: string;
  /** Wire protocol: 'responses' switches the server-side request shape. */
  apiProtocol?: 'chat_completions' | 'responses' | '';
}): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch('/api/test-openapi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `HTTP ${res.status}: OpenAPI connection failed.` };
    }
    return { success: true, message: data.message || 'Connection successful!' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error connecting to backend.' };
  }
}

/** Fetch the provider's model list. Never throws — returns an error string on failure. */
export async function fetchAvailableModels(config: {
  openAIBaseUrl: string;
  openAIApiKey: string;
  projectId?: string;
}): Promise<{ models: string[]; error?: string }> {
  try {
    const res = await fetch('/api/settings/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(config),
    });
    const data = (await res.json()) as { models?: unknown; error?: string };
    if (!res.ok || data.error) {
      return {
        models: [],
        error: data.error || `HTTP ${res.status}: Failed to fetch model list.`,
      };
    }
    return {
      models: Array.isArray(data.models) ? data.models.filter((m): m is string => typeof m === 'string') : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error connecting to backend.';
    return { models: [], error: message };
  }
}
