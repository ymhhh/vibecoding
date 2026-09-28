export type APIProtocol = 'chat_completions' | 'responses';

const CHAT_SUFFIX = '/chat/completions';
const RESPONSES_SUFFIX = '/responses';
/** Legacy OpenAI completions path (not chat). */
const LEGACY_COMPLETIONS_SUFFIX = '/completions';

/** Infer protocol from a known OpenAI-style endpoint path. */
export function protocolFromEndpointURL(url: string): APIProtocol | null {
  const u = url.trim().replace(/\/+$/, '').toLowerCase();
  if (u.endsWith(RESPONSES_SUFFIX)) return 'responses';
  // Check /chat/completions before bare /completions (suffix overlap).
  if (u.endsWith(CHAT_SUFFIX)) return 'chat_completions';
  if (u.endsWith(LEGACY_COMPLETIONS_SUFFIX)) return 'chat_completions';
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
  if (lower.endsWith(LEGACY_COMPLETIONS_SUFFIX)) {
    return base.slice(0, -LEGACY_COMPLETIONS_SUFFIX.length) + nextSuffix + trailingSlash;
  }
  return trimmed;
}

/**
 * Resolve a saved URL + protocol pair when opening settings.
 * A recognizable URL suffix wins (fixes stored mismatches); otherwise the
 * saved protocol is kept and known suffixes are rewritten to match it.
 */
export function resolveEndpointAlignment(
  url: string,
  protocol: APIProtocol
): { url: string; protocol: APIProtocol } {
  const inferred = protocolFromEndpointURL(url);
  const nextProtocol = inferred ?? protocol;
  return {
    protocol: nextProtocol,
    url: alignEndpointURLToProtocol(url, nextProtocol),
  };
}

export function endpointExamples(protocol: APIProtocol): string[] {
  if (protocol === 'responses') {
    return ['https://api.openai.com/v1/responses'];
  }
  return [
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/v1/completions',
    'https://api.deepseek.com/v1/chat/completions',
  ];
}

export function endpointPlaceholder(protocol: APIProtocol): string {
  return protocol === 'responses'
    ? 'https://api.openai.com/v1/responses'
    : 'https://api.openai.com/v1/chat/completions';
}
