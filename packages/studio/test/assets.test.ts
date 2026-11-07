import { describe, expect, it } from 'vitest';
import { readAsset } from '../src/assets';

// run from src, the panel folder is src/ui, and two levels up is this package's own package.json
describe('readAsset', () => {
  // Proved able to fail by checking for '/' on every platform: Windows refused the whole panel.
  it('serves a file inside the panel folder, under the separator of the platform', () => {
    const page = readAsset('/');
    expect(page?.type).toBe('text/html; charset=utf-8');
    expect(page?.body.toString('utf8')).toContain('<html');
    expect(readAsset('/index.html')?.body).toEqual(page?.body);
  });

  // Proved able to fail by dropping the check: package.json was served from outside the panel.
  it('refuses a path that resolves outside the panel folder, with either separator', () => {
    expect(readAsset('../../package.json')).toBeUndefined();
    expect(readAsset('..\\..\\package.json')).toBeUndefined();
  });

  it('refuses a folder and a file that is not there', () => {
    expect(readAsset('/components')).toBeUndefined();
    expect(readAsset('/nope.js')).toBeUndefined();
  });
});
