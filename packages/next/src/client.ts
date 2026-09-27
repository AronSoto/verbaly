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
import { createInstance, locales, requestOptions, routing, sourceLocale } from 'virtual:verbaly';
import type { VerbalyProviderProps as SerializableProps } from './server';

export { Trans, useLocale, useT, useVerbaly } from '@verbaly/react';

// the serializable props getVerbalyProps() produces, plus the client-side children
export interface VerbalyProviderProps extends SerializableProps {
  children?: ReactNode;
}

export function VerbalyProvider(props: VerbalyProviderProps): ReactElement {
  // getVerbalyProps omits them for the source locale, so messages here were passed on purpose
  const [instance] = useState(() => {
    const created = createInstance({ locale: props.locale });
    if (props.messages) created.addMessages(props.locale, props.messages);
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

// core switchLocale in the project's own routing, with the app router as the navigation
export function useSwitchLocale(): (
  locale: string,
  options?: SwitchLocaleOptions,
) => Promise<void> {
  const instance = useVerbaly();
  const router = useRouter();
  return useCallback(
    async (locale, options) => {
      // the project's routing unless told otherwise: under a [locale] segment the url must change
      const settings: SwitchLocaleOptions = {
        cookie: requestOptions?.cookie,
        routing,
        supported: locales,
        sourceLocale,
        // a full load would throw away the react tree the app router exists to keep
        navigate: (path) => router.push(path),
        ...options,
      };
      const routed = settings.routing !== undefined && settings.routing !== 'no-prefix';
      await switchLocale(instance, locale, settings);
      // the navigation already re-rendered the tree, so refreshing on top of it is a second render
      if (!routed) router.refresh();
    },
    [instance, router],
  );
}
