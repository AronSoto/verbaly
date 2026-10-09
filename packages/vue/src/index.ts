import {
  computed,
  defineComponent,
  Fragment,
  h,
  inject,
  onScopeDispose,
  shallowRef,
  type App,
  type InjectionKey,
  type PropType,
  type ShallowRef,
  type VNodeChild,
  type WritableComputedRef,
} from 'vue';
import {
  normalizeLink,
  parseTags,
  RICH_TAGS,
  VOID_TAGS,
  type DictionaryInput,
  type Params,
  type RichLink,
  type TagNode,
  type TFunction,
  type Verbaly,
} from 'verbaly';

const KEY: InjectionKey<Verbaly> = Symbol('verbaly');

export interface VerbalyPlugin {
  install(app: App): void;
}

export function verbalyPlugin<D extends DictionaryInput>(instance: Verbaly<D>): VerbalyPlugin {
  return {
    install(app) {
      app.provide(KEY, instance as unknown as Verbaly);
    },
  };
}

// what virtual:verbaly registers in a browser; a server holds one instance per request instead
const APP_INSTANCE = Symbol.for('verbaly.app');

function appInstance(): Verbaly | null {
  if (typeof document === 'undefined') return null;
  return ((globalThis as Record<symbol, unknown>)[APP_INSTANCE] as Verbaly | undefined) ?? null;
}

// the plugin wins; without it, a browser or a test reads the app's own instance
export function useVerbaly<D extends DictionaryInput = DictionaryInput>(): Verbaly<D> {
  const instance = inject(KEY, null) ?? appInstance();
  if (!instance) {
    throw new Error(
      '[verbaly] useVerbaly requires app.use(verbalyPlugin(...)): on a server, or before virtual:verbaly loads',
    );
  }
  return instance as unknown as Verbaly<D>;
}

// typed by the project's catalog once verbaly.d.ts exists, by a dictionary when one is named
export function useT<D extends DictionaryInput = DictionaryInput>(): Verbaly<D>['t'] {
  const instance = useVerbaly<D>();
  const version = trackVersion(instance);
  const t = (first: unknown, ...rest: unknown[]): string => {
    void version.value;
    return (instance.t as unknown as (...args: unknown[]) => string)(first, ...rest);
  };
  // the reactive wrapper must keep t's full surface (react/svelte hand out instance.t directly)
  (t as unknown as Pick<TFunction, 'id'>).id = instance.t.id;
  return t as unknown as Verbaly<D>['t'];
}

export function useLocale(): WritableComputedRef<string> {
  const instance = useVerbaly();
  const version = trackVersion(instance);
  return computed({
    get: () => {
      void version.value;
      return instance.locale;
    },
    set: (locale: string) => instance.setLocale(locale),
  });
}

function trackVersion<D extends DictionaryInput>(instance: Verbaly<D>): ShallowRef<number> {
  const version = shallowRef(instance.version);
  onScopeDispose(
    instance.subscribe(() => {
      version.value = instance.version;
    }),
  );
  return version;
}

const VOID = new Set(VOID_TAGS);

export type TransComponents = Record<string, (children: VNodeChild[]) => VNodeChild>;

// translated message + element interpolation
export const Trans = defineComponent({
  name: 'Trans',
  props: {
    id: { type: String, required: true },
    values: { type: Object as PropType<Params>, default: undefined },
    instance: { type: Object as PropType<Verbaly>, default: undefined },
    components: { type: Object as PropType<TransComponents>, default: () => ({}) },
    richTags: { type: Array as PropType<string[]>, default: undefined },
    links: { type: Object as PropType<Record<string, RichLink>>, default: () => ({}) },
  },
  setup(props) {
    const instance = props.instance ?? useVerbaly();
    const version = trackVersion(instance);
    return () => {
      void version.value;
      const text = (instance.t as unknown as (id: string, values?: Params) => string)(
        props.id,
        props.values,
      );
      return h(
        Fragment,
        toNodes(
          parseTags(text),
          props.components,
          props.links,
          new Set(props.richTags ?? RICH_TAGS),
        ),
      );
    };
  },
});

// own entries only: a tag named constructor in a message must never find the one on Object
function own<T>(map: Record<string, T>, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
}

function toNodes(
  nodes: TagNode[],
  components: TransComponents,
  links: Record<string, RichLink>,
  richTags: Set<string>,
): VNodeChild[] {
  return nodes.map((node) => {
    if (typeof node === 'string') return node;
    const children = toNodes(node.children, components, links, richTags);
    const fn = own(components, node.name);
    if (fn) return fn(children);
    const link = own(links, node.name);
    if (link !== undefined) {
      return h('a', normalizeLink(link), children);
    }
    if (richTags.has(node.name)) {
      return h(node.name, null, VOID.has(node.name) ? undefined : children);
    }
    return children;
  });
}

export type { Params, TFunction, Verbaly };
