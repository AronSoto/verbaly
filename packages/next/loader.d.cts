// hand-written: the runtime is module.exports = fn, a generated dts would declare ESM default
interface LoaderContext {
  resourcePath: string;
  async(): (error: unknown, code?: string, map?: unknown) => void;
}
declare function verbalyLoader(this: LoaderContext, source: string): void;
export = verbalyLoader;
