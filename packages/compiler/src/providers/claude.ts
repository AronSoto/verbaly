import { isModuleNotFound } from '../config';
import type { TranslateProvider, TranslateRequest } from '../translate';

export interface ClaudeProviderOptions {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
}

// balanced default for translation
const DEFAULT_MODEL = 'claude-sonnet-5';

const SYSTEM = `You translate UI strings for the Verbaly i18n library.
Rules:
- Translate only the human-readable text, naturally for the target locale.
- Preserve verbatim: placeholders like {name}, format specs like {price:currency/EUR}, variant blocks like {count | one: ... | other: # ...} (translate only the text inside each variant, keep keys and # as-is), ICU syntax, named tags like <em>...</em> and escapes {{ }} || ##.
- Keys are opaque identifiers: return exactly the same keys, never translate or rename them.`;

export function claudeProvider(options: ClaudeProviderOptions = {}): TranslateProvider {
  return async (request: TranslateRequest) => {
    const Anthropic = await loadSdk();
    const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    const response = await client.messages.create({
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: options.maxTokens ?? 16000,
      thinking: { type: 'disabled' },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(request) }],
      output_config: { format: batchFormat(request) },
    });
    const text = response.content.find((block) => block.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as Record<string, string>;
  };
}

export function buildPrompt(request: TranslateRequest): string {
  return (
    `Translate each value from "${request.sourceLocale}" to "${request.targetLocale}". ` +
    `Return a JSON object with the same keys and translated values.\n\n` +
    JSON.stringify(request.messages, null, 2)
  );
}

export function batchFormat(request: TranslateRequest) {
  const keys = Object.keys(request.messages);
  return {
    type: 'json_schema' as const,
    schema: {
      type: 'object',
      properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
      required: keys,
      additionalProperties: false,
    },
  };
}

type SdkModule = { default: typeof import('@anthropic-ai/sdk').default };

// injectable for tests
export async function loadSdk(
  load: () => Promise<SdkModule> = () => import('@anthropic-ai/sdk'),
): Promise<SdkModule['default']> {
  try {
    const mod = await load();
    return mod.default;
  } catch (error) {
    if (isModuleNotFound(error, '@anthropic-ai/sdk')) {
      throw new Error(
        '[verbaly] the claude translate provider needs @anthropic-ai/sdk: install it as a dev dependency (e.g. `pnpm add -D @anthropic-ai/sdk` / `npm i -D @anthropic-ai/sdk`) and set ANTHROPIC_API_KEY',
        { cause: error },
      );
    }
    throw error;
  }
}

