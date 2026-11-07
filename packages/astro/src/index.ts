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

interface AstroI18nLike {
  defaultLocale: string;
  locales: (string | { path: string; codes: string[] })[];
  routing?: 'manual' | { prefixDefaultLocale?: boolean };
}
interface AstroConfigLike {
  root: URL;
  trailingSlash?: 'always' | 'never' | 'ignore';
  i18n?: AstroI18nLike;
}

type Routing = NonNullable<ViteVerbalyOptions['routing']>;

// Astro owns the routes: with its i18n routing the url carries the language, and Verbaly follows
function routingFromAstro(i18n: AstroI18nLike | undefined, source: string): Routing | undefined {
  if (!i18n || i18n.routing === 'manual') return undefined;
  // an object is a url of its own only when its path is none of its codes
  const custom = i18n.locales.find(
    (entry) => typeof entry !== 'string' && !entry.codes.includes(entry.path),
  );
  if (typeof custom === 'object') {
    console.warn(
      `[verbaly] Astro's i18n serves ${custom.codes.join(', ')} under /${custom.path}, a path no Verbaly url can follow, so switchLocale and localePath keep one address: use the language code as its path`,
    );
    return undefined;
  }
  if (i18n.routing?.prefixDefaultLocale) return 'prefix-all';
  if (i18n.defaultLocale === source) return 'prefix-except-source';
  console.warn(
    `[verbaly] Astro's i18n serves its defaultLocale "${i18n.defaultLocale}" at the root, but Verbaly's sourceLocale "${source}" is the language without a prefix, so switchLocale and localePath keep one address: make them the same language, or set prefixDefaultLocale: true`,
  );
  return undefined;
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
    'astro:config:setup'(options: ConfigSetupLike): Promise<void>;
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
      // verbaly/app follows the ClientRouter swap itself, so no page gets a script from here
      async 'astro:config:setup'({ config, updateConfig }) {
        // root pinned to the project dir: Astro's Vite root can differ and discovery finds nothing
        root = vite.root ??= fileURLToPath(config.root);
        // the site's own form of a url: every href Verbaly writes or navigates to follows it
        vite.trailingSlash ??= config.trailingSlash;
        if (vite.routing === undefined && config.i18n) {
          const cfg = await loadConfig(root, vite, { plugin: true });
          // no-prefix cannot hold where Astro puts the language in the url; a prefix mode stays
          if (cfg.routing === 'no-prefix') {
            vite.routing = routingFromAstro(config.i18n, cfg.sourceLocale);
          }
        }
        updateConfig({ vite: { plugins: [verbalyVite(vite)] } });
      },
      async 'astro:config:done'(options) {
        buildOutput = options.buildOutput;
        // types go to Astro's own slot (.astro/), no file in the project
        const cfg = await loadConfig(root, vite, { plugin: true });
        const url = options.injectTypes({
          filename: 'verbaly.d.ts',
          // the same options writeDts passes, so the CLI and dev write this very content
          content: generateDts(loadCatalogs(cfg)[cfg.sourceLocale] ?? {}, {
            inlineCatalog: cfg.render.inlineCatalog === true,
            locales: cfg.locales,
          }),
        });
        vite.dts = fileURLToPath(url);
      },
      async 'astro:build:done'({ dir }) {
        const cfg = await loadConfig(root, vite, { plugin: true });
        // mirror is opt-in: a path-based i18n routing site must never get its pages mirrored on top
        const wanted = render === undefined ? Object.keys(cfg.render).length > 0 : Boolean(render);
        if (!wanted) return;
        if (buildOutput === 'server') {
          console.warn(
            "[verbaly] render skipped: only static output can be mirrored per locale. In server output, build the instance per request: `createRequestInstance(Astro.currentLocale ?? sourceLocale)` from 'verbaly/app'",
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
