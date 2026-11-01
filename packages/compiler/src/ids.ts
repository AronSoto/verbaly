export const VIRTUAL_ID = 'virtual:verbaly';
// the name the docs teach: it resolves to the same module as VIRTUAL_ID, which stays an alias
export const APP_ID = 'verbaly/app';
// how the module imports a language: no URI scheme for webpack, nothing a verbaly alias swallows
export const LOCALE_IMPORT = '@verbaly/app/locale/';

// the project's module under either name: what the analyzer and every resolver recognize
export function isAppModule(source: string): boolean {
  return source === APP_ID || source === VIRTUAL_ID;
}
