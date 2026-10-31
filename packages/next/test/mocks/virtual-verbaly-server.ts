// live binding: a test picks whether this project's Next can read the root segment
export let rootLocale: (() => Promise<string | undefined>) | undefined;

export function setRootLocale(next: (() => Promise<string | undefined>) | undefined): void {
  rootLocale = next;
}
