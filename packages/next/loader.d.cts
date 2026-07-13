// hand-written: the runtime is `module.exports = fn` (loader-runner contract);
// generated dts would declare an ESM default export and mismatch under node16
interface LoaderContext {
  resourcePath: string;
  async(): (error: unknown, code?: string, map?: unknown) => void;
}
declare function verbalyLoader(this: LoaderContext, source: string): void;
export = verbalyLoader;
