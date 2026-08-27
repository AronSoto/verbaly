import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, claudeProvider, loadSdk, systemPrompt } from '../src/providers/claude';
import type { TranslateRequest } from '../src/translate';

const request: TranslateRequest = {
  sourceLocale: 'en',
  targetLocale: 'es',
  messages: { greet: 'Hello {name}', bye: 'Bye' },
};

const create = vi.fn();
const ctor = vi.fn();

function mockSdk(): void {
  vi.doMock('@anthropic-ai/sdk', () => ({
    default: class {
      messages = { create };
      constructor(options: unknown) {
        ctor(options);
      }
    },
  }));
}

afterEach(() => {
  vi.doUnmock('@anthropic-ai/sdk');
  vi.resetModules();
  vi.clearAllMocks();
});

describe('claudeProvider', () => {
  it('calls the sdk with defaults and parses the text block', async () => {
    mockSdk();
    create.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ greet: 'Hola {name}', bye: 'Chau' }) }],
    });
    const out = await claudeProvider()(request);
    expect(out).toEqual({ greet: 'Hola {name}', bye: 'Chau' });
    expect(ctor).toHaveBeenCalledWith({});
    const call = create.mock.calls[0]![0];
    expect(call.model).toBe('claude-sonnet-5');
    expect(call.max_tokens).toBe(16000);
    expect(call.system).toContain('Verbaly');
    expect(call.messages).toEqual([{ role: 'user', content: expect.stringContaining('"en"') }]);
    expect(call.output_config.format.schema.required).toEqual(['greet', 'bye']);
  });

  it('honors model, apiKey and maxTokens options', async () => {
    mockSdk();
    create.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    await claudeProvider({ model: 'claude-opus-4-8', apiKey: 'k', maxTokens: 500 })(request);
    expect(ctor).toHaveBeenCalledWith({ apiKey: 'k' });
    const call = create.mock.calls[0]![0];
    expect(call.model).toBe('claude-opus-4-8');
    expect(call.max_tokens).toBe(500);
  });

  it('falls back to {} when no text block comes back', async () => {
    mockSdk();
    create.mockResolvedValue({ content: [{ type: 'thinking', thinking: '…' }] });
    await expect(claudeProvider()(request)).resolves.toEqual({});
  });
});

describe('claudeProvider: an answer that is not one', () => {
  it('names the batch size when the model runs out of output room', async () => {
    mockSdk();
    create.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"greet": "Hola' }],
    });
    await expect(claudeProvider()(request)).rejects.toThrow(/lower translate.batchSize/);
  });

  it('says the answer was not the json it asked for instead of throwing a parse error', async () => {
    mockSdk();
    create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Sure, here you go:' }],
    });
    await expect(claudeProvider()(request)).rejects.toThrow(/did not answer with the JSON object/);
  });

  it('builds the transport once and reuses it across batches', async () => {
    mockSdk();
    create.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    const provider = claudeProvider();
    await provider(request);
    await provider(request);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('claude prompt: instructions and glossary', () => {
  it('appends the project instructions to the system prompt', () => {
    expect(systemPrompt()).not.toContain('Project instructions');
    const withNotes = systemPrompt('Address the reader as tu.');
    expect(withNotes).toContain('Verbaly i18n library');
    expect(withNotes).toContain('Project instructions:');
    expect(withNotes).toContain('Address the reader as tu.');
  });

  it('states the glossary as a requirement and leaves it out when empty', () => {
    const bare = buildPrompt(request);
    expect(bare).not.toContain('Glossary');
    const glossed = buildPrompt({ ...request, glossary: { Verbaly: 'Verbaly', cart: 'carrito' } });
    expect(glossed).toContain('these renderings are required');
    expect(glossed).toContain('Verbaly -> Verbaly');
    expect(glossed).toContain('cart -> carrito');
  });
});

describe('loadSdk', () => {
  const notFound = () =>
    Promise.reject(
      Object.assign(new Error("Cannot find module '@anthropic-ai/sdk'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      }),
    );

  it('explains how to install the sdk when it is missing', async () => {
    await expect(loadSdk(notFound)).rejects.toThrow(/pnpm add -D @anthropic-ai\/sdk/);
  });

  it('rethrows unrelated import errors untouched', async () => {
    await expect(loadSdk(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(
      loadSdk(() =>
        Promise.reject(Object.assign(new Error('other missing'), { code: 'ERR_MODULE_NOT_FOUND' })),
      ),
    ).rejects.toThrow('other missing');
  });
});
