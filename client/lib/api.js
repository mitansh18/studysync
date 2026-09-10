const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// credentials:"include" is what lets the browser send and store the
// httpOnly auth cookie across the :3000 -> :5000 origin boundary.
export async function apiFetch(path, { method = "GET", body } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Unreachable server. Kept distinct from a 401 so callers never mistake
    // "cannot ask" for "not signed in".
    return {
      ok: false,
      status: 0,
      networkError: true,
      data: { message: "Unable to reach the server" },
    };
  }

  const data = await response.json().catch(() => ({}));

  return { ok: response.ok, status: response.status, networkError: false, data };
}
