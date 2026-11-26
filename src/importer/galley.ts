import { load } from "cheerio";
import { downloadTimeoutMs, httpUrl, readResponseBytes, redirectStatuses } from "../core/http.js";
import { codeStepsSelector, codeStepSources, visibleCodeStep } from "./code-steps-source.js";
import { flightData } from "./flight-data.js";
import { mermaidSources } from "./mermaid-source.js";
import { sceneSelector, sceneSources } from "./scene-source.js";
import { restoreStreamedSegments } from "./streamed-html.js";

function articleLocation(url: URL | null, origin: string | null) {
  const encodedSlug = url && /^\/posts\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!url || !httpUrl(url.href) || !encodedSlug) {
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

export function canonicalArticleUrl(value: string): string {
  const { url, slug } = articleLocation(URL.parse(value), null);
  return new URL(`/posts/${encodeURIComponent(slug)}`, url).href;
}

async function readHtml(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "text/html" || !response.body) {
    await response.body?.cancel();
    throw new Error("Galley did not return an HTML article page.");
  }

  const bytes = await readResponseBytes(response, "The Galley page exceeds the 12 MiB import limit.");
  return bytes.toString("utf8");
}

async function requestPage(input: string, baseUrl: string | null) {
  const target = URL.parse(input) ??
    (baseUrl ? new URL(`/posts/${encodeURIComponent(input)}`, baseUrl) : null);
  let location = articleLocation(target, baseUrl);
  const origin = location.url.origin;
  const signal = AbortSignal.timeout(downloadTimeoutMs);

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
  restoreStreamedSegments($);
  const article = $("article.galley-article").first();
  const header = article.children(".galley-article-header");
  const title = header.find(".galley-title").first().text().trim();
  const body = article.find(".galley-prose").first();
  if (body.find('template[id^="P:"]').length > 0) {
    throw new Error("Galley returned an incomplete streamed article. Try importing it again.");
  }
  body.find("script, template, galley-notes").remove();
  const diagrams = body.find("figure.galley-mermaid");
  const restoreMermaid = diagrams.find(".galley-mermaid-placeholder").length > 0;
  const stepFigures = body.find(codeStepsSelector);
  const sceneFigures = body.find(sceneSelector);
  const stream = restoreMermaid || stepFigures.length > 0 || sceneFigures.length > 0 ? flightData($) : "";
  if (restoreMermaid) {
    const sources = mermaidSources(stream, diagrams.length);
    diagrams.each((index, diagram) => {
      const source = sources.get(index);
      if (source && $(diagram).find(".galley-mermaid-placeholder").length > 0) {
        $(diagram).append($("<pre>").addClass("galley-mermaid-source").text(source));
      }
    });
  }
  const steps = stepFigures.length > 0 ? codeStepSources(stream, stepFigures.length) : undefined;
  // Check the rendered first step and count before assigning any recovered props to the snapshot.
  const codeSteps = steps?.every((group, index) => {
    const shown = visibleCodeStep($, stepFigures.eq(index));
    return shown.count === group.steps.length && shown.code.trimEnd() === group.steps[0]?.code.trimEnd();
  }) ? steps : undefined;
  const scenes = sceneFigures.length > 0 ? sceneSources(stream, $, sceneFigures) : undefined;
  const bodyHtml = body.html()?.trim();
  if (!title || !bodyHtml) {
    throw new Error("The page has no Galley article title or rendered body.");
  }

  const tags = article.children(".galley-tags").find("a").toArray()
    .map((tag) => $(tag).text().trim())
    .filter(Boolean);
  const images = body.find("img").toArray().flatMap((image) => {
    const src = $(image).attr("src")?.trim();
    const imageUrl = src && httpUrl(src, url);
    if (!imageUrl) return [];
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
    ...(codeSteps ? { codeSteps } : {}),
    ...(scenes ? { scenes } : {}),
  };
}
