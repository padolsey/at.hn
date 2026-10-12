// Explicit deployment setting; never infer preview mode from an incoming Host.
export const previewHost = process.env.PREVIEW_HOST || '';
if (previewHost) {
  const url = new URL(`https://${previewHost}`);
  if (!/^[a-z0-9.-]+$/.test(previewHost) || url.host !== previewHost ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PREVIEW_HOST must be a lowercase hostname without a scheme, port or path');
  }
}
