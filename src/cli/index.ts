#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { initializeConfig, loadConfig, workspacePaths } from "../core/config.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command()
  .name("goldmine")
  .description("Manage a local workspace for published Galley articles.")
  .version(manifest.version)
  .option("--data-dir <path>", "override GOLDMINE_HOME or ~/.goldmine");

program
  .command("init")
  .description("initialize the local workspace")
  .option("--galley-url <origin>", "set the Galley site when creating the workspace")
  .action((options: { galleyUrl?: string }) => {
    const paths = workspacePaths(program.opts<{ dataDir?: string }>().dataDir);
    const created = initializeConfig(paths, options.galleyUrl);
    console.log(created ? `Created ${paths.config}` : `Workspace ready at ${paths.root}`);
  });

program
  .command("doctor")
  .description("check the local workspace and the optional Wechatsync executable")
  .action(() => {
    const paths = workspacePaths(program.opts<{ dataDir?: string }>().dataDir);
    const config = loadConfig(paths);
    console.log(`Configuration: ${paths.config}`);
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

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
