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

export { Trans, useLocale, useT, useVerbaly } from '@verbaly/react';

export interface VerbalyProviderProps {
  locale: string;
  messages?: Record<string, string>;
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

  // server changed the locale out-of-band (cookie edit + refresh) — follow it
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

// core switchLocale (catalog → locale → cookie + <html lang>) + RSC re-render
export function useSwitchLocale(): (
  locale: string,
  options?: SwitchLocaleOptions,
) => Promise<void> {
  const instance = useVerbaly();
  const router = useRouter();
  return useCallback(
    async (locale, options) => {
      await switchLocale(instance, locale, { cookie: requestOptions?.cookie, ...options });
      router.refresh();
    },
    [instance, router],
  );
}
