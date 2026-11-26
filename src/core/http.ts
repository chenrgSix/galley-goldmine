import type { Response as UndiciResponse } from "undici";

export const maxDownloadBytes = 12 * 1024 * 1024;
export const downloadTimeoutMs = 10_000;
export const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export function httpUrl(value: string, base?: URL | string): URL | null {
  const url = URL.parse(value, base);
  return url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    ? url
    : null;
}

export async function readResponseBytes(
  response: Pick<Response | UndiciResponse, "body">, limitMessage: string,
): Promise<Buffer> {
  if (!response.body) throw new Error("The HTTP response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxDownloadBytes) throw new Error(limitMessage);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
