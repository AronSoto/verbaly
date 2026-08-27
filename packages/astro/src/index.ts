import {
  counted,
  generateDts,
  loadCatalogs,
  loadConfig,
  formatRenderWarnings,
  renderSite,
  type RenderConfig,
} from '@verbaly/compiler';
import verbalyVite, { type ViteVerbalyOptions } from '@verbaly/vite';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type { RenderConfig, VerbalyConfig } from '@verbaly/compiler';
export type { ViteVerbalyOptions } from '@verbaly/vite';

export interface VerbalyAstroOptions extends Omit<ViteVerbalyOptions, 'render'> {
  render?: boolean | RenderConfig;
}

interface AstroConfigLike {
  root: URL;
}
interface ConfigSetupLike {
  config: AstroConfigLike;
  updateConfig(config: { vite?: { plugins?: unknown } }): unknown;
}
interface ConfigDoneLike {
  buildOutput?: 'static' | 'server';
  injectTypes(injectedType: { filename: string; content: string }): URL;
}
interface BuildDoneLike {
  dir: URL;
}
export interface VerbalyAstroIntegration {
  name: string;
  hooks: {
    'astro:config:setup'(options: ConfigSetupLike): void;
    'astro:config:done'(options: ConfigDoneLike): Promise<void>;
    'astro:build:done'(options: BuildDoneLike): Promise<void>;
  };
}

export default function verbaly(options: VerbalyAstroOptions = {}): VerbalyAstroIntegration {
  const { render, ...rest } = options;
  // one shared mutable options object: config:done fills dts, the plugin reads it lazily
  const vite: ViteVerbalyOptions = typeof render === 'object' ? { ...rest, render } : rest;
  let root = '';
  let buildOutput: 'static' | 'server' | undefined;

  return {
    name: '@verbaly/astro',
    hooks: {
      'astro:config:setup'({ config, updateConfig }) {
        // root pinned to the project dir: Astro's Vite root can differ and discovery finds nothing
        root = vite.root ??= fileURLToPath(config.root);
        updateConfig({ vite: { plugins: [verbalyVite(vite)] } });
      },
      async 'astro:config:done'(options) {
        buildOutput = options.buildOutput;
        // types go to Astro's own slot (.astro/), no file in the project
        const cfg = await loadConfig(root, vite);
        const url = options.injectTypes({
          filename: 'verbaly.d.ts',
          content: generateDts(loadCatalogs(cfg)[cfg.sourceLocale] ?? {}),
        });
        vite.dts = fileURLToPath(url);
      },
      async 'astro:build:done'({ dir }) {
        const cfg = await loadConfig(root, vite);
        // mirror is opt-in: a path-based i18n routing site must never get its pages mirrored on top
        const wanted = render === undefined ? Object.keys(cfg.render).length > 0 : Boolean(render);
        if (!wanted) return;
        if (buildOutput === 'server') {
          console.warn(
            '[verbaly] render skipped: only static output can be mirrored per locale (server-rendered pages already pick their locale per request)',
          );
          return;
        }
        const site = relative(cfg.root, fileURLToPath(dir)) || '.';
        const result = await renderSite(cfg, { site });
        console.log(
          `[verbaly] render: ${counted(result.files, 'page')} × ${counted(result.locales.length, 'locale')} (${result.locales.join(', ')})`,
        );
        for (const line of formatRenderWarnings(result, cfg.sourceLocale)) console.warn(line);
      },
    },
  };
}
