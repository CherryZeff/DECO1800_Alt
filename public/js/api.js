// All shared data goes through the same server that serves the pages.
export async function apiRequest(path, method = 'GET', data) {
  const url = new URL(`../../api/${path}`, import.meta.url);
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(65000),
    });
  } catch {
    throw new Error(
      'Cannot reach ParkPal. Start node server.js and open http://localhost:3000.',
    );
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      'Shared storage needs the ParkPal server. Open http://localhost:3000 instead of Live Server.',
    );
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed. Please try again.');
  return result;
}
