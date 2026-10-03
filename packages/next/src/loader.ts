// webpack/turbopack loader: async because @verbaly/compiler is ESM-only (dynamic import)

// what withVerbaly passes: the scope extract reads, so the loader rewrites nothing outside it
export interface LoaderOptions {
  root?: string;
  include?: string[];
  exclude?: string[];
}

export interface LoaderContext {
  resourcePath: string;
  async(): (error: unknown, code?: string, map?: unknown) => void;
  getOptions?(): LoaderOptions;
}

type Compiler = typeof import('@verbaly/compiler');

let compiler: Promise<Compiler> | undefined;
// one matcher per scope: the loader runs once per module and picomatch compiles the globs
const filters = new Map<string, (id: string) => boolean>();

function inScope(load: Compiler, options: LoaderOptions, file: string): boolean {
  // wired by hand with no options, the loader keeps rewriting every source file it is given
  if (!options.root || !options.include) return true;
  const key = JSON.stringify(options);
  let filter = filters.get(key);
  if (!filter) {
    const scope = { root: options.root, include: options.include, exclude: options.exclude ?? [] };
    filter = load.createSourceFilter(scope as Parameters<Compiler['createSourceFilter']>[0]);
    filters.set(key, filter);
  }
  return filter(file);
}

export default function verbalyLoader(this: LoaderContext, source: string): void {
  const callback = this.async();
  const file = this.resourcePath;
  const options = this.getOptions?.() ?? {};
  compiler ??= import('@verbaly/compiler');
  compiler
    .then((load) => {
      if (!load.isTransformTarget(file) || !inScope(load, options, file)) {
        callback(null, source);
        return;
      }
      const result = load.transformCode(source, file);
      if (result) {
        // MagicString maps carry an empty source and Turbopack panics resolving it to a directory
        result.map.sources = [file];
        callback(null, result.code, result.map);
      } else {
        callback(null, source);
      }
    })
    .catch((error: unknown) => callback(error));
}
