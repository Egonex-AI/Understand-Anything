type AuthRejectedListener = () => void;

const rejectedListeners =
  new Map<string, Set<AuthRejectedListener>>();

export function subscribeAuthRejected(
  token: string,
  listener: AuthRejectedListener,
): () => void {
  let listeners = rejectedListeners.get(token);

  if (!listeners) {
    listeners = new Set();
    rejectedListeners.set(token, listeners);
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 &&
        rejectedListeners.get(token) === listeners) {
      rejectedListeners.delete(token);
    }
  };
}

/**
 * Send credentials only to the local dashboard origin.
 */
export function authFetch(
  resource: RequestInfo | URL,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = new URL(
    resource instanceof Request ? resource.url : resource,
    window.location.origin,
  );

  if (url.origin !== window.location.origin) {
    return Promise.reject(
      new Error("Authenticated requests must remain same-origin"),
    );
  }

  const headers = new Headers(
    options.headers ??
      (resource instanceof Request ? resource.headers : undefined),
  );
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(resource instanceof Request ? resource : url.href, {
    ...options,
    headers,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  }).then((response) => {
    if (
      response.status === 403 &&
      response.headers.get("X-UA-Auth-Status") === "invalid-token"
    ) {
      const listeners = rejectedListeners.get(token);

      if (listeners) {
        for (const listener of [...listeners]) {
          listener();
        }
      }
    }

    return response;
  });
}
