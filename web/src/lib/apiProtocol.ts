export type APIProtocol = 'chat_completions' | 'responses';

const CHAT_SUFFIX = '/chat/completions';
const RESPONSES_SUFFIX = '/responses';

/** Infer protocol from a known OpenAI-style endpoint path. */
export function protocolFromEndpointURL(url: string): APIProtocol | null {
  const u = url.trim().replace(/\/+$/, '').toLowerCase();
  if (u.endsWith(RESPONSES_SUFFIX)) return 'responses';
  if (u.endsWith(CHAT_SUFFIX)) return 'chat_completions';
  return null;
}

/**
 * When the URL ends with a known protocol path, swap that suffix to match `protocol`.
 * Custom gateway paths without these suffixes are left unchanged.
 */
export function alignEndpointURLToProtocol(url: string, protocol: APIProtocol): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const trailingSlash = /\/+$/.test(trimmed) ? '/' : '';
  const base = trimmed.replace(/\/+$/, '');
  const lower = base.toLowerCase();
  const nextSuffix = protocol === 'responses' ? RESPONSES_SUFFIX : CHAT_SUFFIX;
  if (lower.endsWith(CHAT_SUFFIX)) {
    return base.slice(0, -CHAT_SUFFIX.length) + nextSuffix + trailingSlash;
  }
  if (lower.endsWith(RESPONSES_SUFFIX)) {
    return base.slice(0, -RESPONSES_SUFFIX.length) + nextSuffix + trailingSlash;
  }
  return trimmed;
}

export function endpointExamples(protocol: APIProtocol): string[] {
  if (protocol === 'responses') {
    return ['https://api.openai.com/v1/responses'];
  }
  return [
    'https://api.openai.com/v1/chat/completions',
    'https://api.deepseek.com/v1/chat/completions',
  ];
}

export function endpointPlaceholder(protocol: APIProtocol): string {
  return protocol === 'responses'
    ? 'https://api.openai.com/v1/responses'
    : 'https://api.openai.com/v1/chat/completions';
}
