/**
 * A small fetch wrapper for Supabase's Auth and REST endpoints. No SDK: the
 * app has no dependencies, and these endpoints are plain JSON over HTTPS.
 */

export class CloudError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }
}

function messageOf(data, status) {
  return data?.msg ?? data?.error_description ?? data?.message ?? data?.error ?? `Request failed (${status}).`;
}

/** Returns a request function bound to one project. `token` is the user's access token; the anon key is used otherwise. */
export function createHttp({ url, anonKey, fetchImpl = globalThis.fetch }) {
  return async function request(path, { method = 'GET', body, token = null, headers = {} } = {}) {
    const init = {
      method,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token ?? anonKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, init);
    } catch {
      throw new CloudError('Quire could not reach the server. Check your connection and try again.');
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    if (!response.ok) {
      throw new CloudError(messageOf(data, response.status), { status: response.status, code: data?.error_code ?? data?.error ?? null });
    }
    return data;
  };
}
