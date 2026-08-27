'use client';

import { useRouter } from 'next/navigation';
import {
  createElement,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { VerbalyProvider as ReactVerbalyProvider, useVerbaly } from '@verbaly/react';
import { switchLocale, type SwitchLocaleOptions } from 'verbaly';
import { createInstance, requestOptions, sourceLocale } from 'virtual:verbaly';
import type { VerbalyProviderProps as SerializableProps } from './server';

export { Trans, useLocale, useT, useVerbaly } from '@verbaly/react';

// the serializable props getVerbalyProps() produces, plus the client-side children
export interface VerbalyProviderProps extends SerializableProps {
  children?: ReactNode;
}

export function VerbalyProvider(props: VerbalyProviderProps): ReactElement {
  const [instance] = useState(() => {
    const created = createInstance({ locale: props.locale });
    if (props.messages && props.locale !== sourceLocale) {
      created.addMessages(props.locale, props.messages);
    }
    return created;
  });

  // server changed the locale out-of-band (cookie edit + refresh): follow it
  useEffect(() => {
    if (props.locale === instance.locale) return;
    if (props.messages) {
      instance.addMessages(props.locale, props.messages);
      instance.setLocale(props.locale);
    } else {
      void instance.loadLocale(props.locale).then(() => instance.setLocale(props.locale));
    }
  }, [props.locale, props.messages, instance]);

  return createElement(ReactVerbalyProvider, { instance }, props.children);
}

// core switchLocale in whichever mode the app is in, with the app router as the navigation
export function useSwitchLocale(): (
  locale: string,
  options?: SwitchLocaleOptions,
) => Promise<void> {
  const instance = useVerbaly();
  const router = useRouter();
  return useCallback(
    async (locale, options) => {
      const routed = options?.routing !== undefined && options.routing !== 'no-prefix';
      await switchLocale(instance, locale, {
        cookie: requestOptions?.cookie,
        // a full load would throw away the react tree the app router exists to keep
        navigate: (path) => router.push(path),
        ...options,
      });
      // the navigation already re-rendered the tree, so refreshing on top of it is a second render
      if (!routed) router.refresh();
    },
    [instance, router],
  );
}
