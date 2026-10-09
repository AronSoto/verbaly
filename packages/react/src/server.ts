import type { ReactElement } from 'react';
import type { Verbaly } from 'verbaly';
import { renderTrans, type TransProps } from './render';

export { renderTrans } from './render';
export type { TransOptions, TransProps } from './render';

// a Server Component has no provider to read and no hooks to call, so the instance is a prop
export function Trans(props: TransProps & { instance: Verbaly }): ReactElement {
  return renderTrans(props.instance, props);
}
