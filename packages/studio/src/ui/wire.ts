// Every route answers JSON and every failure has to read like a sentence, so it is asked once here.
export interface Answer<T> {
  value?: T;
  error?: string;
}

export async function ask<T>(
  token: string,
  path: string,
  // an intersection narrows body, it does not replace it, so the fetch shape is omitted first
  init?: Omit<RequestInit, 'body'> & { body?: unknown },
): Promise<Answer<T>> {
  const join = path.includes('?') ? '&' : '?';
  let response: Response;
  try {
    response = await fetch(`${path}${join}t=${encodeURIComponent(token)}`, {
      ...init,
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { error: '[verbaly] the studio server is not answering, is it still running?' };
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    return { error: body.error ?? `[verbaly] the server answered ${response.status}` };
  }
  return { value: body };
}
