/**
 * Lightweight self-test for URL ↔ API protocol helpers (no Vitest).
 * Run: npx --yes tsx src/lib/apiProtocol.selftest.ts
 */
import {
  alignEndpointURLToProtocol,
  protocolFromEndpointURL,
  resolveEndpointAlignment,
} from './apiProtocol.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(protocolFromEndpointURL('https://api.openai.com/v1/responses') === 'responses', 'responses');
assert(
  protocolFromEndpointURL('https://api.openai.com/v1/chat/completions') === 'chat_completions',
  'chat'
);
assert(
  protocolFromEndpointURL('https://api.openai.com/v1/completions') === 'chat_completions',
  'legacy completions'
);
assert(protocolFromEndpointURL('https://api.openai.com/v1/completions/') === 'chat_completions', 'legacy slash');
assert(protocolFromEndpointURL('https://gateway.example/v1') === null, 'custom root');

assert(
  alignEndpointURLToProtocol('https://api.openai.com/v1/responses', 'chat_completions') ===
    'https://api.openai.com/v1/chat/completions',
  'responses→chat'
);
assert(
  alignEndpointURLToProtocol('https://api.openai.com/v1/chat/completions', 'responses') ===
    'https://api.openai.com/v1/responses',
  'chat→responses'
);
assert(
  alignEndpointURLToProtocol('https://api.openai.com/v1/completions', 'responses') ===
    'https://api.openai.com/v1/responses',
  'legacy→responses'
);
assert(
  alignEndpointURLToProtocol('https://api.openai.com/v1/completions', 'chat_completions') ===
    'https://api.openai.com/v1/chat/completions',
  'legacy→chat'
);
assert(
  alignEndpointURLToProtocol('https://gateway.example/custom', 'responses') ===
    'https://gateway.example/custom',
  'custom unchanged'
);
assert(
  alignEndpointURLToProtocol('https://api.openai.com/v1/responses/', 'chat_completions') ===
    'https://api.openai.com/v1/chat/completions/',
  'preserve trailing slash'
);

const openMismatch = resolveEndpointAlignment(
  'https://api.openai.com/v1/responses',
  'chat_completions'
);
assert(openMismatch.protocol === 'responses', 'open: url wins protocol');
assert(openMismatch.url === 'https://api.openai.com/v1/responses', 'open: keep responses url');

const openLegacy = resolveEndpointAlignment(
  'https://api.openai.com/v1/completions',
  'responses'
);
assert(openLegacy.protocol === 'chat_completions', 'open: legacy implies chat');
assert(openLegacy.url === 'https://api.openai.com/v1/chat/completions', 'open: normalize legacy');

const openCustom = resolveEndpointAlignment('https://gateway.example/v1', 'responses');
assert(openCustom.protocol === 'responses', 'open: keep protocol for custom');
assert(openCustom.url === 'https://gateway.example/v1', 'open: leave custom url');

console.log('apiProtocol.selftest: ok');
