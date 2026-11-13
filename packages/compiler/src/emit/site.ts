import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import { alternateLinks, type RichLink, type TrailingSlash } from 'verbaly';
import { emptyCatalog, loadCatalogs } from '../catalog/catalog';
import { extractProject } from '../scan/extract';
import { shippedCatalogs } from '../scan/sync';
import type { RedirectConfig, ResolvedConfig } from '../config/config';
import { counted, trimTrailingSlashes } from '../util/text';
import {
  escapeAttr,
  localeInstance,
  normalizeBase,
  publicPath,
  renderHtml,
  type Alternate,
  type RedirectScript,
} from './render';
import { relativePath } from '../util/path';

export interface RenderSiteOptions {
  site?: string;
  locales?: string[];
  attribute?: string;
  richTags?: string[];
  richLinks?: Record<string, RichLink>;
  base?: string;
  baseUrl?: string;
  hreflang?: boolean;
  exclude?: string[];
  sitemap?: boolean | string;
  redirect?: boolean | RedirectConfig;
  clean?: boolean;
}

export interface RenderSiteResult {
  files: number;
  locales: string[];
  missing: Record<string, string[]>;
  untranslatedHead: string[];
}

const TITLE_TAG = /<title\b([^>]*)>/i;
const REFRESH_META = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i;

const NOINDEX_META = /<meta\b[^>]*name\s*=\s*["']?robots["']?[^>]*content\s*=\s*["'][^"']*noindex/i;

// the mirror still publishes these, they are simply never search results
function isIndexable(html: string): boolean {
  return !REFRESH_META.test(html) && !NOINDEX_META.test(html);
}

// a <title> with no key ships the source language everywhere, and it is most of a search result
function headIsBound(html: string, attr: string): boolean {
  // a page that only redirects is never a search result, so its title is nobody's to translate
  if (REFRESH_META.test(html)) return true;
  const title = TITLE_TAG.exec(html);
  return title ? title[1]!.includes(attr) : true;
}

// mirrors the built site per locale: dist/index.html → dist/<locale>/index.html
export async function renderSite(
  cfg: ResolvedConfig,
  options: RenderSiteOptions = {},
): Promise<RenderSiteResult> {
  const site = join(cfg.root, options.site ?? cfg.render.site ?? 'dist');
  const locales = options.locales ?? cfg.locales;
  const attribute = options.attribute ?? cfg.render.attribute;
  const base = normalizeBase(options.base ?? cfg.render.base);
  const wantedUrl = options.baseUrl ?? cfg.render.baseUrl;
  const baseUrl = typeof wantedUrl === 'string' ? trimTrailingSlashes(wantedUrl) : undefined;
  const wantHreflang = (options.hreflang ?? cfg.render.hreflang ?? true) && baseUrl !== undefined;
  // the escape hatch for a page that is indexable and still not ours to list
  const patterns = options.exclude ?? cfg.render.exclude ?? [];
  const excluded = patterns.length > 0 ? picomatch(patterns) : () => false;
  const sitemap = options.sitemap ?? cfg.render.sitemap ?? false;
  const wantSitemap = sitemap !== false && baseUrl !== undefined;
  const clean = options.clean ?? cfg.render.clean ?? false;
  const wanted = options.redirect ?? cfg.render.redirect ?? false;
  const redirect = wanted === false ? undefined : wanted === true ? {} : wanted;
  const script: RedirectScript | undefined = redirect && {
    locales,
    sourceLocale: cfg.sourceLocale,
    base,
    storageKey: redirect.storageKey,
    trailingSlash: cfg.trailingSlash,
  };
  // the text the build ships, or the pre-filled page and the runtime that repaints it disagree
  const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), await extractProject(cfg));
  // one runtime per locale for the whole run: rebuilding it per page reflattened every catalog
  const instances = new Map(
    locales.map((locale) => [locale, localeInstance(catalogs, locale, cfg.sourceLocale)]),
  );

  if (clean) {
    for (const locale of locales) {
      if (locale !== cfg.sourceLocale) rmSync(join(site, locale), { recursive: true, force: true });
    }
  }

  const files = await glob('**/*.html', {
    cwd: site,
    absolute: true,
    ignore: locales.map((locale) => `${locale}/**`),
  });

  // every page the mirror will hold, so a link into one of them can keep the visitor inside
  const pages = new Set(files.map((file) => publicPath(relativePath(site, file))));

  const unfilled = emptyCatalog<Set<string>>();
  const untranslatedHead: string[] = [];
  const urls: Array<{ rel: string; alternates: Alternate[] }> = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const rel = relativePath(site, file);
    // one locale is not a mirror, so there is no second title for this one to disagree with
    if (locales.length > 1 && !headIsBound(html, attribute ?? 'data-verbaly')) {
      untranslatedHead.push(rel);
    }
    const alternates = wantHreflang
      ? pageAlternates(baseUrl!, rel, locales, cfg.sourceLocale, cfg.trailingSlash)
      : [];
    if (wantHreflang && isIndexable(html) && !excluded(rel)) urls.push({ rel, alternates });
    // only the source tree carries it: the mirror page a visitor reaches is already the answer
    const routed = script && (redirect!.on === 'all' || rel === 'index.html');
    for (const locale of locales) {
      const result = renderHtml(html, {
        locale,
        instance: instances.get(locale)!,
        sourceLocale: cfg.sourceLocale,
        attribute,
        richTags: options.richTags,
        richLinks: options.richLinks ?? cfg.render.links,
        alternates,
        mirror:
          locale === cfg.sourceLocale
            ? undefined
            : { prefix: `/${locale}`, base, pages, trailingSlash: cfg.trailingSlash },
        redirect: routed && locale === cfg.sourceLocale ? script : undefined,
        inlineCatalog: cfg.render.inlineCatalog === true,
      });
      for (const key of result.missing) (unfilled[locale] ??= new Set()).add(key);
      const out = locale === cfg.sourceLocale ? file : join(site, locale, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, result.html);
    }
  }

  if (wantSitemap && urls.length) {
    const name = typeof sitemap === 'string' ? sitemap : 'sitemap-i18n.xml';
    writeFileSync(join(site, name), buildSitemap(urls));
  }

  const missing = emptyCatalog<string[]>();
  for (const [locale, keys] of Object.entries(unfilled)) missing[locale] = [...keys];
  return { files: files.length, locales: [...locales], missing, untranslatedHead };
}

// the cli and @verbaly/astro both run the mirror, so what it warns about is written once
export function formatRenderWarnings(result: RenderSiteResult, sourceLocale: string): string[] {
  const lines: string[] = [];
  for (const [locale, keys] of Object.entries(result.missing)) {
    lines.push(`  ${locale}: ${counted(keys.length, 'key')} not pre-filled: ${keys.join(', ')}`);
  }
  if (result.untranslatedHead.length > 0) {
    lines.push(
      `  ${counted(result.untranslatedHead.length, 'page')} of ${result.files} ship the same <title> in every locale (${result.untranslatedHead[0]}), so search results read in ${sourceLocale}`,
      `    fix: bind the head too, <title data-verbaly="key"> and a meta through data-verbaly-attr`,
    );
  }
  return lines;
}

// request path of a built page path (index.html → directory URL)
function pagePath(rel: string): string {
  const path = rel.replace(/(^|\/)index\.html$/, '$1');
  return path ? `/${path}` : '/';
}

// reciprocal hreflang set for one page, from core: an SSR head has to write the same one
function pageAlternates(
  baseUrl: string,
  rel: string,
  locales: string[],
  sourceLocale: string,
  trailingSlash: TrailingSlash | undefined,
): Alternate[] {
  return alternateLinks({
    supported: locales,
    sourceLocale,
    path: pagePath(rel),
    routing: 'prefix-except-source',
    baseUrl,
    trailingSlash,
  });
}

function buildSitemap(urls: Array<{ rel: string; alternates: Alternate[] }>): string {
  const body = urls
    .flatMap(({ alternates }) => {
      const alts = alternates
        .map(
          (a) =>
            `<xhtml:link rel="alternate" hreflang="${escapeAttr(a.hreflang)}" href="${escapeAttr(a.href)}"/>`,
        )
        .join('');
      return alternates
        .filter((a) => a.hreflang !== 'x-default')
        .map((self) => `<url><loc>${escapeAttr(self.href)}</loc>${alts}</url>`);
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>\n`;
}
