export const ensureHttps = (url: string): string => {
  if (!url.startsWith('http')) {
    return `https://${url}`;
  }
  return url;
}