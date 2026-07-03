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
  parseTags,
  type DictionaryInput,
  type Params,
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

export function useVerbaly<D extends DictionaryInput = DictionaryInput>(): Verbaly<D> {
  const instance = inject(KEY, null);
  if (!instance) {
    throw new Error('[verbaly] useVerbaly requires app.use(verbalyPlugin(...))');
  }
  return instance as unknown as Verbaly<D>;
}

export function useT<D extends DictionaryInput = DictionaryInput>(): TFunction<D> {
  const instance = useVerbaly<D>();
  const version = trackVersion(instance);
  const t = (first: unknown, ...rest: unknown[]): string => {
    void version.value;
    return (instance.t as unknown as (...args: unknown[]) => string)(first, ...rest);
  };
  return t as TFunction<D>;
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

export type TransComponents = Record<string, (children: VNodeChild[]) => VNodeChild>;

// translated message + element interpolation
export const Trans = defineComponent({
  name: 'Trans',
  props: {
    id: { type: String, required: true },
    values: { type: Object as PropType<Params>, default: undefined },
    components: { type: Object as PropType<TransComponents>, default: () => ({}) },
  },
  setup(props) {
    const instance = useVerbaly();
    const version = trackVersion(instance);
    return () => {
      void version.value;
      const text = (instance.t as unknown as (id: string, values?: Params) => string)(
        props.id,
        props.values,
      );
      return h(Fragment, toNodes(parseTags(text), props.components));
    };
  },
});

function toNodes(nodes: TagNode[], components: TransComponents): VNodeChild[] {
  return nodes.map((node) => {
    if (typeof node === 'string') return node;
    const children = toNodes(node.children, components);
    const fn = components[node.name];
    return fn ? fn(children) : children;
  });
}

export type { Params, TFunction, Verbaly };
