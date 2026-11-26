#!/usr/bin/env node
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Option } from "commander";
import { initializeConfig, loadConfig, workspacePaths } from "../core/config.js";
import { initializeDatabase, withDatabase } from "../core/db/client.js";
import { articleSnapshots, platforms, type Platform } from "../core/db/schema.js";
import { readGalleyArticle } from "../importer/galley.js";
import { listArticles, saveSnapshot } from "../importer/snapshots.js";
import { resolveAttempt, syncBuild } from "../publisher/sync.js";
import { publisherAvailable } from "../publisher/wechatsync.js";
import { previewBuild, recordReview } from "../review/reviews.js";
import { distributionStatus } from "../review/status.js";
import { buildArticle } from "../transform/build.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command()
  .name("goldmine")
  .description("Manage a local workspace for published Galley articles.")
  .version(manifest.version)
  .option("--data-dir <path>", "override GOLDMINE_HOME or ~/.goldmine");

function pathsForCommand() {
  return workspacePaths(program.opts<{ dataDir?: string }>().dataDir);
}

function terminalTitle(title: string): string {
  return title.replace(/\s+/gu, " ").replace(/\p{Cc}/gu, "");
}

program
  .command("init")
  .description("initialize the local workspace")
  .option("--galley-url <origin>", "set the Galley site when creating the workspace")
  .option("--json", "print the workspace paths as JSON")
  .action((options: { galleyUrl?: string; json?: boolean }) => {
    const paths = pathsForCommand();
    const created = initializeConfig(paths, options.galleyUrl);
    initializeDatabase(paths);
    if (options.json) {
      console.log(JSON.stringify({ ...paths, created }));
      return;
    }
    console.log(created ? `Created ${paths.config}` : `Workspace ready at ${paths.root}`);
  });

program
  .command("serve")
  .description("start the authenticated Goldmine web dashboard")
  .option("--host <address>", "web listener address", "127.0.0.1")
  .option("--port <port>", "web listener port", "8787")
  .option("--galley-url <origin>", "set the Galley site when creating the workspace")
  .action(async (options: { host: string; port: string; galleyUrl?: string }) => {
    const port = Number(options.port);
    if (!/^\d+$/u.test(options.port) || port < 1 || port > 65535) throw new Error("Use a web port from 1 to 65535.");
    const origin = process.env.GOLDMINE_WEB_ORIGIN || `http://127.0.0.1:${port}`;
    const password = process.env.GOLDMINE_ADMIN_PASSWORD ?? "";
    delete process.env.GOLDMINE_ADMIN_PASSWORD;
    const { createWebServer } = await import("../web/server.js");
    const server = await createWebServer(pathsForCommand(), {
      origin,
      password,
      galleyUrl: options.galleyUrl ?? (process.env.GOLDMINE_GALLEY_URL || undefined),
    });
    server.listen(port, options.host);
    await once(server, "listening");
    console.log(`Goldmine dashboard at ${origin}`);
  });

program
  .command("doctor")
  .description("check the workspace, Wechatsync executable and Mermaid renderer")
  .option("--json", "print the checks as JSON")
  .action(async (options: { json?: boolean }) => {
    const paths = pathsForCommand();
    const config = loadConfig(paths);
    withDatabase(paths, true, (db) => db.select().from(articleSnapshots).limit(1).get());
    const wechatsync = publisherAvailable(config.publisher.command);
    const { mermaidAvailable } = await import("../transform/mermaid.js");
    const mermaid = await mermaidAvailable();
    if (options.json) {
      console.log(JSON.stringify({
        config: paths.config, database: paths.database, galleyUrl: config.galley.baseUrl, wechatsync, mermaid,
      }));
      return;
    }
    console.log(`Configuration: ${paths.config}`);
    console.log(`SQLite: ${paths.database}`);
    console.log(`Galley: ${config.galley.baseUrl ?? "Using explicit article URLs"}`);
    console.log(`Wechatsync CLI (optional): ${wechatsync ? "available" : "unavailable"}`);
    console.log(`Mermaid renderer (optional): ${mermaid ? "available" : "unavailable"}`);
  });

program
  .command("import <article>")
  .description("save a snapshot of a public Galley article URL or slug")
  .option("--json", "print the snapshot index entry as JSON")
  .action(async (article: string, options: { json?: boolean }) => {
    const paths = pathsForCommand();
    const config = loadConfig(paths);
    const source = await readGalleyArticle(article, config.galley.baseUrl);
    const result = saveSnapshot(paths, source);
    if (options.json) {
      console.log(JSON.stringify(result));
      return;
    }
    const action = result.created ? "Imported" : "Already imported";
    console.log(`${action} ${terminalTitle(result.title)} (v${result.version})`);
    console.log(result.snapshotPath);
  });

program
  .command("list")
  .description("list the latest snapshot of each imported article")
  .option("--json", "print the article index as JSON")
  .action((options: { json?: boolean }) => {
    const paths = pathsForCommand();
    loadConfig(paths);
    const entries = listArticles(paths);
    if (options.json) {
      console.log(JSON.stringify(entries));
      return;
    }
    if (entries.length === 0) console.log("No articles imported.");
    for (const entry of entries) {
      console.log(`v${entry.version}\t${terminalTitle(entry.title)}\t${entry.sourceUrl}`);
    }
  });

program
  .command("build <article>")
  .description("convert an imported article for one platform")
  .addOption(new Option("--platform <platform>", "target platform").choices([...platforms]).makeOptionMandatory())
  .option("--title <text>", "override the article title")
  .option("--summary <text>", "override the article summary")
  .option("--cover <file>", "use a local image as the cover")
  .option("--json", "print the build manifest and paths as JSON")
  .action(async (article: string, options: {
    platform: Platform; title?: string; summary?: string; cover?: string; json?: boolean;
  }) => {
    const paths = pathsForCommand();
    loadConfig(paths);
    const build = await buildArticle(paths, article, options);
    if (options.json) {
      console.log(JSON.stringify(build));
      return;
    }
    console.log(`Built ${build.platform} v${build.version} revision ${build.revision} (${build.id})`);
    console.log(build.files.preview);
    for (const warning of build.warnings) console.log(`[${warning.severity}] ${terminalTitle(warning.message)}`);
  });

program
  .command("preview <build-id>")
  .description("show the local preview and assets for a build")
  .option("--json", "print the preview details as JSON")
  .action((id: string, options: { json?: boolean }) => {
    const paths = pathsForCommand();
    loadConfig(paths);
    const preview = previewBuild(paths, id);
    if (options.json) {
      console.log(JSON.stringify(preview));
      return;
    }
    console.log(preview.files.preview);
    for (const warning of preview.warnings) console.log(`[${warning.severity}] ${terminalTitle(warning.message)}`);
    for (const asset of preview.assets) console.log(`${asset.kind}\t${join(paths.assets, asset.file)}`);
  });

program
  .command("review <build-id>")
  .description("record an approval or rejection of the current build")
  .option("--approve", "approve the build")
  .option("--reject", "reject the build")
  .option("--note <text>", "record a review note")
  .option("--json", "print the review as JSON")
  .action((id: string, options: { approve?: boolean; reject?: boolean; note?: string; json?: boolean }) => {
    if (Boolean(options.approve) === Boolean(options.reject)) throw new Error("Choose either --approve or --reject.");
    const paths = pathsForCommand();
    loadConfig(paths);
    const result = recordReview(paths, id, options.approve ? "approved" : "rejected", options.note);
    console.log(options.json ? JSON.stringify(result) : `Review ${result.id}: ${result.decision} ${result.buildId}`);
  });

program
  .command("status [article]")
  .description("show snapshots, platform builds, reviews and sync attempts")
  .option("--json", "print the distribution status as JSON")
  .action((article: string | undefined, options: { json?: boolean }) => {
    const paths = pathsForCommand();
    loadConfig(paths);
    const entries = distributionStatus(paths, article);
    if (options.json) {
      console.log(JSON.stringify(entries));
      return;
    }
    if (entries.length === 0) console.log("No articles imported.");
    for (const entry of entries) {
      console.log(`v${entry.version}\t${terminalTitle(entry.title)}\t${entry.sourceUrl}`);
      for (const build of entry.builds) {
        const blockers = build.warnings.filter(({ severity }) => severity === "blocking").length;
        console.log(`  ${build.platform} r${build.revision}\t${build.id}\t${build.reviewState} (${blockers} blocking)`);
        for (const attempt of build.attempts) {
          console.log(`    #${attempt.id}\t${attempt.mode}\t${attempt.status}`);
        }
      }
    }
  });

program
  .command("sync <build-id>")
  .description("preview or send the build to Wechatsync")
  .option("--dry-run", "show what would be sent without connecting to the platform")
  .option("--json", "print the sync attempt as JSON")
  .action(async (id: string, options: { dryRun?: boolean; json?: boolean }) => {
    const paths = pathsForCommand();
    const config = loadConfig(paths);
    const attempt = await syncBuild(paths, id, config.publisher.command, options.dryRun === true);
    if (options.json) console.log(JSON.stringify(attempt));
    else {
      console.log(`Attempt #${attempt.id}: ${attempt.mode} ${attempt.status}`);
      if (attempt.outputExcerpt) console.log(attempt.outputExcerpt);
      if (attempt.draftUrl) console.log(attempt.draftUrl);
    }
    if (attempt.status !== "succeeded") process.exitCode = 1;
  });

program
  .command("resolve <attempt-id>")
  .description("record the result of manually checking an unknown sync attempt")
  .option("--succeeded", "confirm that the draft was created")
  .option("--failed", "confirm that no draft was created")
  .option("--draft-url <url>", "record the draft link when confirming success")
  .requiredOption("--note <text>", "record what was found in the draft box")
  .option("--json", "print the resolved attempt as JSON")
  .action((id: string, options: {
    succeeded?: boolean; failed?: boolean; draftUrl?: string; note: string; json?: boolean;
  }) => {
    if (Boolean(options.succeeded) === Boolean(options.failed)) throw new Error("Choose either --succeeded or --failed.");
    const attemptId = Number(id);
    if (!/^\d+$/u.test(id) || !Number.isSafeInteger(attemptId) || attemptId < 1) throw new Error("Use a valid attempt ID.");
    const paths = pathsForCommand();
    loadConfig(paths);
    const attempt = resolveAttempt(paths, attemptId, options.succeeded ? "succeeded" : "failed", options.note, options.draftUrl);
    console.log(options.json ? JSON.stringify(attempt) : `Resolved attempt #${attempt.id}: ${attempt.status}`);
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
