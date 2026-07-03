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
import type { DictionaryInput, Params, TFunction, Verbaly } from 'verbaly';

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
      return h(Fragment, renderTags(text, props.components));
    };
  },
});

const TAG = /<(\/?)([a-zA-Z][\w-]*)(\/?)>/g;

function renderTags(text: string, components: TransComponents): VNodeChild[] {
  const tag = new RegExp(TAG.source, 'g');
  let pos = 0;

  const walk = (stop: string | null): VNodeChild[] => {
    const out: VNodeChild[] = [];
    let m: RegExpExecArray | null;
    while ((m = tag.exec(text)) !== null) {
      const [full, closing, name, selfClose] = m;
      if (m.index > pos) out.push(text.slice(pos, m.index));
      pos = m.index + full.length;
      if (closing) {
        if (name === stop) return out;
        out.push(full); // stray close → literal
      } else if (selfClose) {
        const fn = components[name!];
        out.push(fn ? fn([]) : full);
      } else {
        const children = walk(name!);
        const fn = components[name!];
        if (fn) out.push(fn(children));
        else out.push(...children); // unknown tag → text
      }
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  };
  return walk(null);
}

export type { Params, TFunction, Verbaly };
