// webpack/turbopack loader: async because @verbaly/compiler is ESM-only (dynamic import)

export interface LoaderContext {
  resourcePath: string;
  async(): (error: unknown, code?: string, map?: unknown) => void;
}

let compiler: Promise<typeof import('@verbaly/compiler')> | undefined;

export default function verbalyLoader(this: LoaderContext, source: string): void {
  const callback = this.async();
  const file = this.resourcePath;
  compiler ??= import('@verbaly/compiler');
  compiler
    .then(({ isTransformTarget, transformCode }) => {
      if (!isTransformTarget(file)) {
        callback(null, source);
        return;
      }
      const result = transformCode(source, file);
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
