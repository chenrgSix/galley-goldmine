#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { initializeConfig, loadConfig, workspacePaths } from "../core/config.js";
import { initializeDatabase, withDatabase } from "../core/db/client.js";
import { articleSnapshots } from "../core/db/schema.js";
import { readGalleyArticle } from "../importer/galley.js";
import { listArticles, saveSnapshot } from "../importer/snapshots.js";

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
  .action((options: { galleyUrl?: string }) => {
    const paths = pathsForCommand();
    const created = initializeConfig(paths, options.galleyUrl);
    initializeDatabase(paths);
    console.log(created ? `Created ${paths.config}` : `Workspace ready at ${paths.root}`);
  });

program
  .command("doctor")
  .description("check the local workspace and the optional Wechatsync executable")
  .action(() => {
    const paths = pathsForCommand();
    const config = loadConfig(paths);
    withDatabase(paths, true, (db) => db.select().from(articleSnapshots).limit(1).get());
    console.log(`Configuration: ${paths.config}`);
    console.log(`SQLite: ${paths.database}`);
    console.log(`Galley: ${config.galley.baseUrl ?? "Using explicit article URLs"}`);

    const env = { ...process.env };
    delete env.WECHATSYNC_TOKEN;
    const result = spawnSync(config.publisher.command, ["--version"], {
      env,
      stdio: "ignore",
      timeout: 3000,
      windowsHide: true,
    });
    console.log(`Wechatsync CLI (optional): ${result.status === 0 ? "available" : "unavailable"}`);
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

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
