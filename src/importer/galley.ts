import { load } from "cheerio";

const maxPageBytes = 12 * 1024 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function isHttpUrl(url: URL): boolean {
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
}

function articleLocation(url: URL | null, origin: string | null) {
  const encodedSlug = url && /^\/posts\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!url || !isHttpUrl(url) || !encodedSlug) {
    throw new Error("Use a public Galley URL in the form https://site.example/posts/slug.");
  }
  if (origin && url.origin !== origin) {
    throw new Error(`The article must come from ${origin}.`);
  }
  let slug: string;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    throw new Error("The article URL contains an invalid slug.");
  }
  if (/[\s/\\?#\p{Cc}]/u.test(slug) || slug === "." || slug === "..") {
    throw new Error("The article URL contains an invalid slug.");
  }
  url.search = "";
  url.hash = "";
  return { url, slug };
}

async function readHtml(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "text/html" || !response.body) {
    await response.body?.cancel();
    throw new Error("Galley did not return an HTML article page.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxPageBytes) throw new Error("The Galley page exceeds the 12 MiB import limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function requestPage(input: string, baseUrl: string | null) {
  const target = URL.parse(input) ??
    (baseUrl ? new URL(`/posts/${encodeURIComponent(input)}`, baseUrl) : null);
  let location = articleLocation(target, baseUrl);
  const origin = location.url.origin;
  const signal = AbortSignal.timeout(10_000);

  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(location.url, {
      headers: { accept: "text/html" },
      credentials: "omit",
      redirect: "manual",
      signal,
    });
    if (response.ok) {
      return { location, html: await readHtml(response) };
    }
    await response.body?.cancel();
    if (!redirectStatuses.has(response.status)) {
      throw new Error(`Galley returned HTTP ${response.status} for the article.`);
    }
    const next = response.headers.get("location");
    location = articleLocation(next ? URL.parse(next, location.url) : null, origin);
  }
  throw new Error("The Galley page redirected too many times.");
}

export type GalleyArticle = Awaited<ReturnType<typeof readGalleyArticle>>;

export async function readGalleyArticle(input: string, baseUrl: string | null) {
  const { location: { url, slug }, html } = await requestPage(input, baseUrl);
  const $ = load(html);
  const article = $("article.galley-article").first();
  const header = article.children(".galley-article-header");
  const title = header.find(".galley-title").first().text().trim();
  const body = article.find(".galley-prose").first();
  body.find("script, template, galley-notes").remove();
  const bodyHtml = body.html()?.trim();
  if (!title || !bodyHtml) {
    throw new Error("The page has no Galley article title or rendered body.");
  }

  const tags = article.children(".galley-tags").find("a").toArray()
    .map((tag) => $(tag).text().trim())
    .filter(Boolean);
  const images = body.find("img").toArray().flatMap((image) => {
    const src = $(image).attr("src")?.trim();
    const imageUrl = src && URL.parse(src, url);
    if (!imageUrl || !isHttpUrl(imageUrl)) return [];
    return [{ url: imageUrl.href, alt: $(image).attr("alt") ?? "" }];
  });
  const summary = $("meta[name='description']").first().attr("content")?.trim() ||
    $("meta[property='og:description']").first().attr("content")?.trim() || null;

  return {
    schemaVersion: 1 as const,
    sourceUrl: new URL(`/posts/${encodeURIComponent(slug)}`, url).href,
    slug,
    title,
    summary,
    category: header.find(".galley-meta-category").first().text().trim() || null,
    tags: [...new Set(tags)],
    bodyHtml,
    images,
  };
}
