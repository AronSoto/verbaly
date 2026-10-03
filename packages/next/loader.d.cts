// hand-written: the runtime is module.exports = fn, a generated dts would declare ESM default
interface LoaderOptions {
  root?: string;
  include?: string[];
  exclude?: string[];
}
interface LoaderContext {
  resourcePath: string;
  async(): (error: unknown, code?: string, map?: unknown) => void;
  getOptions?(): LoaderOptions;
}
declare function verbalyLoader(this: LoaderContext, source: string): void;
export = verbalyLoader;
