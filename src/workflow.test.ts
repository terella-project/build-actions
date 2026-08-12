import { expect, test } from "bun:test";
import {
  createActionComposition,
  MockActionRuntime,
  runComposedAction,
} from "@terella/action-framework";
import { BuildActionsWorkflow } from "./workflow";

interface ExecCall {
  cmd: string;
  args: string[];
}

function createContext(
  calls: ExecCall[],
  outputs: Map<string, { exitCode: number; stdout: string; stderr: string }>,
  mockRuntime: MockActionRuntime,
) {
  return createActionComposition(
    {
      githubContext: { repo: { owner: "owner", repo: "repo" } },
      dependencies: {
        createExecClient: () => ({
          exec: async (cmd: string, args?: string[]) => {
            calls.push({ cmd, args: args ?? [] });
            return 0;
          },
          getExecOutput: async (
            cmd: string,
            args?: string[],
            _opts?: { ignoreReturnCode?: boolean },
          ) => {
            calls.push({ cmd, args: args ?? [] });
            const key = `${cmd} ${(args ?? []).join(" ")}`;
            return outputs.get(key) ?? { exitCode: 0, stdout: "", stderr: "" };
          },
        }),
      },
    },
    { runtime: mockRuntime },
  );
}

test("BuildActionsWorkflow finds and builds actions under the path", async () => {
  const mockRuntime = new MockActionRuntime();
  mockRuntime.inputs["path"] = "test-actions";
  mockRuntime.inputs["minify"] = "false";
  mockRuntime.inputs["packages"] = "bundle";

  const calls: ExecCall[] = [];
  const outputs = new Map<
    string,
    { exitCode: number; stdout: string; stderr: string }
  >([["bun --version", { exitCode: 0, stdout: "1.2.0\n", stderr: "" }]]);

  // Create a temporary test action structure
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const testDir = "test-actions/sample-action";
  await mkdir(join(testDir, "src"), { recursive: true });
  await writeFile(
    join(testDir, "action.yml"),
    'name: "sample"\ndescription: "test"\nruns:\n  using: "node20"\n  main: "dist/index.js"\n',
  );
  await writeFile(join(testDir, "src/index.ts"), 'console.log("hello");\n');

  try {
    const composition = createContext(calls, outputs, mockRuntime);
    await runComposedAction(composition, BuildActionsWorkflow);

    // Bun version was checked (already installed)
    expect(
      calls.some((c) => c.cmd === "bun" && c.args[0] === "--version"),
    ).toBe(true);

    // No install needed since bun was found
    expect(calls.some((c) => c.cmd === "bash")).toBe(false);

    // A temp build script was invoked with bun run
    expect(
      calls.some(
        (c) =>
          c.cmd === "bun" &&
          c.args[0] === "run" &&
          c.args[1]?.endsWith(".build-tmp.mjs"),
      ),
    ).toBe(true);

    // Success was logged
    expect(
      mockRuntime.logs.some((l) => l.message.includes("Built 1 action(s)")),
    ).toBe(true);
  } finally {
    await rm("test-actions", { recursive: true, force: true });
  }
});

test("BuildActionsWorkflow installs Bun when not found", async () => {
  const mockRuntime = new MockActionRuntime();
  mockRuntime.inputs["path"] = "no-such-dir";

  const calls: ExecCall[] = [];
  const outputs = new Map<
    string,
    { exitCode: number; stdout: string; stderr: string }
  >([["bun --version", { exitCode: 1, stdout: "", stderr: "not found" }]]);

  const composition = createContext(calls, outputs, mockRuntime);

  await runComposedAction(composition, BuildActionsWorkflow);

  // Bash install was triggered
  expect(calls.some((c) => c.cmd === "bash" && c.args.includes("-c"))).toBe(
    true,
  );
});

test("BuildActionsWorkflow reports when no actions found", async () => {
  const mockRuntime = new MockActionRuntime();
  mockRuntime.inputs["path"] = "empty-nonexistent";

  const calls: ExecCall[] = [];
  const outputs = new Map<
    string,
    { exitCode: number; stdout: string; stderr: string }
  >([["bun --version", { exitCode: 0, stdout: "1.2.0\n", stderr: "" }]]);

  const composition = createContext(calls, outputs, mockRuntime);

  await runComposedAction(composition, BuildActionsWorkflow);

  expect(mockRuntime.logs).toContainEqual({
    level: "info",
    message: "No actions found under empty-nonexistent/",
  });
});

test("BuildActionsWorkflow rejects invalid packages input", async () => {
  const mockRuntime = new MockActionRuntime();
  mockRuntime.inputs["packages"] = "weird";

  const composition = createContext([], new Map(), mockRuntime);

  await runComposedAction(composition, BuildActionsWorkflow);

  expect(mockRuntime.failedMessage).toBe(
    "Invalid packages value: weird. Use 'bundle' or 'external'.",
  );
});
