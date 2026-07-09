import { afterEach, describe, expect, it, vi } from 'vitest';
import { claudeProvider, loadSdk } from '../src/providers/claude';
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
