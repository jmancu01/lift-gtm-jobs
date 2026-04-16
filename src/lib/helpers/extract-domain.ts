export function extractDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
