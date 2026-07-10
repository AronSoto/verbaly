import type { ResolveStatus, Verbaly } from './types';

export interface DevtoolsOptions {
  root?: ParentNode;
  attribute?: string;
  hotkey?: 'alt' | 'ctrl' | 'shift' | 'meta';
  catalogDir?: string;
}

interface Bound {
  el: Element;
  key: string;
  status: ResolveStatus;
  from?: string;
  source?: string;
}

const HOTKEY: Record<NonNullable<DevtoolsOptions['hotkey']>, keyof MouseEvent> = {
  alt: 'altKey',
  ctrl: 'ctrlKey',
  shift: 'shiftKey',
  meta: 'metaKey',
};

// dev-only inspector — "what key is this text?" in the browser (opt-in, tree-shakeable)
export function attachDevtools(instance: Verbaly, options: DevtoolsOptions = {}): () => void {
  if (typeof document === 'undefined') throw new Error('[verbaly] devtools requires a DOM');
  const root = options.root ?? document.body;
  const attr = options.attribute ?? 'data-verbaly';
  const modifier = HOTKEY[options.hotkey ?? 'alt'];
  const dir = options.catalogDir ?? 'locales';

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'verbaly-dt';
  root.appendChild(panel);

  const tip = document.createElement('div');
  tip.className = 'verbaly-dt-tip';
  tip.hidden = true;
  root.appendChild(tip);

  function scan(): Bound[] {
    const out: Bound[] = [];
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      if (!key) continue;
      const info = instance.inspect(key);
      out.push({
        el,
        key,
        status: !info ? 'miss' : info.locale === instance.locale ? 'hit' : 'fallback',
        from: info?.locale,
        source: info?.source,
      });
    }
    return out;
  }

  function render(): void {
    const bound = scan();
    const miss = bound.filter((b) => b.status === 'miss');
    const fb = bound.filter((b) => b.status === 'fallback');
    const rows = miss
      .map(
        (b) =>
          `<li><code>${esc(b.key)}</code><span>add to <code>${esc(dir)}/${esc(instance.locale)}.json</code></span></li>`,
      )
      .join('');
    panel.innerHTML =
      `<div class="verbaly-dt-hd"><b>verbaly</b> · ${esc(instance.locale)}</div>` +
      `<div class="verbaly-dt-stats">` +
      `<span class="ok">${bound.length - miss.length - fb.length} ok</span>` +
      `<span class="fb">${fb.length} fallback</span>` +
      `<span class="miss">${miss.length} missing</span></div>` +
      (rows ? `<ul class="verbaly-dt-miss">${rows}</ul>` : '') +
      `<div class="verbaly-dt-hint">hold <kbd>${options.hotkey ?? 'Alt'}</kbd> + hover to inspect</div>`;
  }

  function onMove(e: MouseEvent): void {
    if (!e[modifier]) {
      tip.hidden = true;
      return;
    }
    const el = (e.target as Element | null)?.closest?.(`[${attr}]`);
    if (!el) {
      tip.hidden = true;
      return;
    }
    const key = el.getAttribute(attr)!;
    const info = instance.inspect(key);
    const status: ResolveStatus = !info
      ? 'miss'
      : info.locale === instance.locale
        ? 'hit'
        : 'fallback';
    tip.innerHTML =
      `<div class="verbaly-dt-key">${esc(key)}</div>` +
      `<div class="verbaly-dt-row ${status}">${status}${info && info.locale !== instance.locale ? ` · from ${esc(info.locale)}` : ''}</div>` +
      (info ? `<div class="verbaly-dt-src">${esc(info.source)}</div>` : '');
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 320)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }

  const unsub = instance.subscribe(render);
  // own panel/tip writes must not re-trigger render (infinite microtask loop)
  const observer = new MutationObserver((records) => {
    if (records.every((r) => panel.contains(r.target) || tip.contains(r.target))) return;
    render();
  });
  observer.observe(root instanceof Node ? root : document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [attr],
  });
  document.addEventListener('mousemove', onMove);
  render();

  return () => {
    unsub();
    observer.disconnect();
    document.removeEventListener('mousemove', onMove);
    panel.remove();
    tip.remove();
    style.remove();
  };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CSS = `
.verbaly-dt{position:fixed;bottom:12px;right:12px;z-index:2147483646;max-width:300px;font:12px/1.4 ui-monospace,monospace;color:#e6f0e0;background:#0b120c;border:1px solid #2a3a2c;border-radius:10px;padding:10px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.verbaly-dt-hd{font-size:11px;opacity:.85;margin-bottom:6px}
.verbaly-dt-stats{display:flex;gap:8px;margin-bottom:6px}
.verbaly-dt-stats span{padding:2px 6px;border-radius:6px;background:#152016}
.verbaly-dt-stats .ok{color:#bef12d}
.verbaly-dt-stats .fb{color:#f1c40f}
.verbaly-dt-stats .miss{color:#ff6b6b}
.verbaly-dt-miss{list-style:none;margin:0 0 6px;padding:0;max-height:180px;overflow:auto}
.verbaly-dt-miss li{display:flex;flex-direction:column;gap:2px;padding:4px 0;border-top:1px solid #1c281d}
.verbaly-dt-miss span{opacity:.6;font-size:11px}
.verbaly-dt-hint{opacity:.55;font-size:11px}
.verbaly-dt-hint kbd{background:#152016;border-radius:4px;padding:0 4px}
.verbaly-dt-tip{position:fixed;z-index:2147483647;max-width:300px;font:12px/1.4 ui-monospace,monospace;color:#e6f0e0;background:#0b120c;border:1px solid #2a3a2c;border-radius:8px;padding:8px;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.verbaly-dt-key{color:#bef12d;font-weight:600;margin-bottom:4px}
.verbaly-dt-row{margin-bottom:4px}
.verbaly-dt-row.miss{color:#ff6b6b}
.verbaly-dt-row.fallback{color:#f1c40f}
.verbaly-dt-row.hit{color:#7bd88f}
.verbaly-dt-src{opacity:.75;white-space:pre-wrap;word-break:break-word}
`;
