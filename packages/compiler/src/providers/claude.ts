import { isModuleNotFound } from '../config';
import { counted } from '../text';
import type { TranslateProvider, TranslateRequest } from '../translate';

export interface ClaudeProviderOptions {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
}

// balanced default for translation: the current Sonnet, at the price of the one before it
const DEFAULT_MODEL = 'claude-sonnet-5-5';

// the models that take fallbacks "default": a batch one declines is answered by another model
const FALLBACK_MODELS = new Set([
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
]);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// the least thinking each model takes: disabled is a 400 on the newest, and the oldest never think
export function thinkingFor(model: string): { type: 'between_tools' | 'disabled' } | undefined {
  if (model === 'claude-sonnet-5-5') return { type: 'between_tools' };
  if (model === 'claude-sonnet-5' || model === 'claude-opus-5') return { type: 'disabled' };
  return undefined;
}

const SYSTEM = `You translate UI strings for the Verbaly i18n library.
Rules:
- Translate only the human-readable text, naturally for the target locale.
- Preserve verbatim: placeholders like {name}, format specs like {price:currency/EUR}, variant blocks like {count | one: ... | other: # ...} (translate only the text inside each variant, keep keys and # as-is), ICU syntax, named tags like <em>...</em> and escapes {{ }} || ##.
- Keys are opaque identifiers: return exactly the same keys, never translate or rename them.`;

export function systemPrompt(instructions?: string): string {
  return instructions ? `${SYSTEM}\n\nProject instructions:\n${instructions}` : SYSTEM;
}

export function claudeProvider(options: ClaudeProviderOptions = {}): TranslateProvider {
  // one client per provider: a batch is a request, not a reason to rebuild the transport
  let client: Promise<InstanceType<typeof import('@anthropic-ai/sdk').default>> | undefined;

  return async (request: TranslateRequest) => {
    client ??= loadSdk().then(
      (Anthropic) => new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {}),
    );
    const model = options.model ?? DEFAULT_MODEL;
    const thinking = thinkingFor(model);
    const response = await (
      await client
    ).beta.messages.create({
      model,
      max_tokens: options.maxTokens ?? 16000,
      ...(thinking && { thinking }),
      ...(FALLBACK_MODELS.has(model) && { betas: [FALLBACK_BETA], fallbacks: 'default' as const }),
      system: systemPrompt(request.instructions),
      messages: [{ role: 'user', content: buildPrompt(request) }],
      output_config: { format: batchFormat(request) },
    });
    const batch = counted(Object.keys(request.messages).length, 'message');
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `[verbaly] the model ran out of output room on a batch of ${batch}: lower translate.batchSize (or raise maxTokens on the provider)`,
      );
    }
    // a decline is about the content, so asking again gets the same answer: a 400 is never retried
    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category;
      throw Object.assign(
        new Error(
          `[verbaly] the model declined a batch of ${batch}${category ? ` (${category})` : ''}, so they stay untranslated: translate them by hand or with another provider`,
        ),
        { status: 400 },
      );
    }
    const text = response.content.find((block) => block.type === 'text')?.text ?? '{}';
    try {
      return JSON.parse(text) as Record<string, string>;
    } catch (error) {
      throw new Error('[verbaly] the model did not answer with the JSON object it was asked for', {
        cause: error,
      });
    }
  };
}

export function buildPrompt(request: TranslateRequest): string {
  return (
    `Translate each value from "${request.sourceLocale}" to "${request.targetLocale}". ` +
    `Return a JSON object with the same keys and translated values.\n\n` +
    JSON.stringify(request.messages, null, 2) +
    glossarySection(request) +
    originsSection(request)
  );
}

// the glossary is a requirement, not a hint: it exists because a brand name came back translated
function glossarySection(request: TranslateRequest): string {
  const glossary = request.glossary;
  if (!glossary || Object.keys(glossary).length === 0) return '';
  const lines = Object.entries(glossary).map(([term, rendering]) => `  ${term} -> ${rendering}`);
  return `\n\nGlossary, these renderings are required wherever the term appears:\n${lines.join('\n')}`;
}

function originsSection(request: TranslateRequest): string {
  const origins = request.origins;
  if (!origins || Object.keys(origins).length === 0) return '';
  const lines = Object.entries(origins).map(([key, files]) => `  ${key}: ${files.join(', ')}`);
  return `\n\nWhere each string appears (context for tone and length, do not translate these paths):\n${lines.join('\n')}`;
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
