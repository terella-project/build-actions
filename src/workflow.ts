import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  ACTION_COMPONENTS,
  type ActionRuntime,
  type ExecClient,
  Inject,
  InjectableWorkflow,
} from "@terella/action-framework";

/**
 * Reusable action that builds all actions in a directory using Bun.
 *
 * Designed for consumers of @terella/action-framework: scaffold actions with
 * `terella-action init`, then in your workflow use this action to build them
 * before `uses: ./actions/<name>`.
 *
 * - Installs Bun if not already available.
 * - Walks the given path for directories containing action.yml.
 * - Bundles each action's src entry -> dist/index.js (self-contained by default).
 * - Writes dist/package.json with {"type":"module"}.
 */
@InjectableWorkflow()
export class BuildActionsWorkflow {
  constructor(
    @Inject(ACTION_COMPONENTS.actionRuntime)
    private readonly runtime: ActionRuntime,
    @Inject(ACTION_COMPONENTS.mainDependencies)
    private readonly deps: { createExecClient: () => ExecClient },
  ) {}

  async run(): Promise<void> {
    const path = this.runtime.getInput("path") || "actions";
    const minify = this.runtime.getBooleanInput("minify");
    const packages = (this.runtime.getInput("packages") || "bundle") as
      | "bundle"
      | "external";

    if (packages !== "bundle" && packages !== "external") {
      this.runtime.setFailed(
        `Invalid packages value: ${packages}. Use 'bundle' or 'external'.`,
      );
      return;
    }

    const exec = this.deps.createExecClient();
    await this.ensureBun(exec);

    const actionDirs = await this.findActionDirs(path);
    if (actionDirs.length === 0) {
      this.runtime.info(`No actions found under ${path}/`);
      return;
    }

    this.runtime.info(
      `Found ${actionDirs.length} action(s): ${actionDirs.map((d) => basename(d)).join(", ")}`,
    );

    for (const dir of actionDirs) {
      await this.buildOne(exec, dir, minify, packages);
    }

    this.runtime.info(`Built ${actionDirs.length} action(s)`);
  }

  private async ensureBun(exec: ExecClient): Promise<void> {
    const result = await exec.getExecOutput("bun", ["--version"], {
      ignoreReturnCode: true,
    });
    if (result.exitCode === 0) {
      this.runtime.info(`Bun ${result.stdout.trim()} already installed`);
      return;
    }

    this.runtime.info("Installing Bun...");
    await exec.exec("bash", ["-c", "curl -fsSL https://bun.sh/install | bash"]);
    const home = process.env.HOME ?? "";
    const bunBin = `${home}/.bun/bin`;
    process.env.PATH = `${bunBin}:${process.env.PATH ?? ""}`;
    this.runtime.addPath(bunBin);
  }

  private async findActionDirs(rootPath: string): Promise<string[]> {
    const dirs: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      const hasActionYml = entries.some(
        (e) =>
          (e.name === "action.yml" || e.name === "action.yaml") && e.isFile(),
      );

      if (hasActionYml) {
        dirs.push(dir);
        return;
      }

      for (const entry of entries) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name));
        }
      }
    };

    await walk(resolve(rootPath));
    return dirs.sort();
  }

  private async buildOne(
    exec: ExecClient,
    actionDir: string,
    minify: boolean,
    packages: "bundle" | "external",
  ): Promise<void> {
    const name = basename(actionDir);
    this.runtime.info(`Building ${name}...`);

    const mainFile = await this.readMainFile(actionDir);
    const entry = mainFile.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
    const entryPath = join(actionDir, entry);
    const outdir = join(actionDir, dirname(mainFile));

    try {
      await stat(entryPath);
    } catch {
      this.runtime.setFailed(`Entry not found for ${name}: ${entry}`);
      return;
    }

    await rm(outdir, { recursive: true, force: true });

    const tempScript = join(actionDir, ".build-tmp.mjs");
    const script = `const result = await Bun.build({
  entrypoints: ${JSON.stringify([entryPath])},
  outdir: ${JSON.stringify(outdir)},
  target: "node",
  format: "esm",
  packages: ${JSON.stringify(packages)},
  sourcemap: "external",
  minify: ${minify},
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
`;
    await writeFile(tempScript, script);

    try {
      const result = await exec.getExecOutput("bun", ["run", tempScript], {
        ignoreReturnCode: true,
      });

      if (result.exitCode !== 0) {
        this.runtime.setFailed(`Failed to build ${name}: ${result.stderr}`);
        return;
      }

      await mkdir(outdir, { recursive: true });
      await writeFile(
        join(outdir, "package.json"),
        `${JSON.stringify({ type: "module" }, null, 2)}\n`,
      );
      this.runtime.info(`Built ${name} -> ${outdir}`);
    } finally {
      await rm(tempScript, { force: true });
    }
  }

  private async readMainFile(actionDir: string): Promise<string> {
    for (const name of ["action.yml", "action.yaml"]) {
      try {
        const content = await readFile(join(actionDir, name), "utf8");
        const match = content.match(/^\s*main:\s*["']?([^"'\n#]+)["']?/m);
        if (match?.[1]) {
          return match[1].trim();
        }
        return "dist/index.js";
      } catch {
        // try next
      }
    }
    return "dist/index.js";
  }
}
