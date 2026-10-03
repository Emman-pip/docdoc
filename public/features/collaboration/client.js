export async function request(path, input, token, ownerToken) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ownerToken ? { 'X-Owner-Key': ownerToken } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The host could not synchronize this document.');
  return result;
}
