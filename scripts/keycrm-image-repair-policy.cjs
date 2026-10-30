'use strict';

// Pure policy for an explicit image-only repair. Importing never connects,
// downloads or writes. The installed materializer owns DNS/SSRF and byte checks.
function imageCandidates(picture) {
  const found = [];
  function add(value) {
    if (found.length >= 3 || typeof value !== 'string' || value.length > 8192) return;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
      const candidate = url.href;
      if (!found.includes(candidate)) found.push(candidate);
    } catch { /* Missing or unsupported provider picture, never a guessed URL. */ }
  }
  function visit(value, depth) {
    if (found.length >= 3 || depth > 2) return;
    if (Array.isArray(value)) {
      for (const row of value.slice(0, 20)) visit(row, depth + 1);
    } else if (value && typeof value === 'object') {
      add(value.url);
      add(value.original_file_url);
      add(value.thumbnail);
    } else add(value);
  }
  visit(picture, 0);
  return found;
}

function positiveId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function findImageProduct(rawOrder, externalItemId) {
  if (!rawOrder || !positiveId(rawOrder.id) || !Array.isArray(rawOrder.products)
    || typeof externalItemId !== 'string') return undefined;
  const matches = rawOrder.products.filter(product => product && positiveId(product.id)
    && externalItemId === `${rawOrder.id}:${product.id}`);
  return matches.length === 1 ? matches[0] : undefined;
}

module.exports = { imageCandidates, findImageProduct };
