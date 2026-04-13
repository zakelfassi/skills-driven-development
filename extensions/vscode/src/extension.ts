import * as vscode from "vscode";

type SkddCommand = "forge" | "doctor" | "link";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("skdd.forge", () => runForge()),
    vscode.commands.registerCommand("skdd.doctor", () => runSkddCommand("doctor", [])),
    vscode.commands.registerCommand("skdd.link", () => runSkddCommand("link", [])),
  );
}

export function deactivate(): void {
  // no-op
}

async function runForge(): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Skill name (kebab-case, 1-64 chars)",
    placeHolder: "my-new-skill",
    validateInput: (value: string) => {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
        return "Must be lowercase kebab-case (e.g. my-new-skill)";
      }
      if (value.length > 64) return "Max 64 characters";
      return null;
    },
  });
  if (!name) return;

  const description = await vscode.window.showInputBox({
    prompt: "Skill description — include trigger language like 'Use when …'",
    placeHolder: "Scaffold REST endpoints. Use when adding a new API route.",
  });
  if (!description) return;

  const args: string[] = [name, "--from-description", description];
  await runSkddCommand("forge", args);
}

async function runSkddCommand(command: SkddCommand, args: string[]): Promise<void> {
  const config = vscode.workspace.getConfiguration("skdd");
  const cliPath = config.get<string>("cliPath") ?? "skdd";
  const useTerminal = config.get<boolean>("openTerminalOnCommand") ?? true;

  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    void vscode.window.showErrorMessage("SkDD: open a workspace folder first.");
    return;
  }

  const quoted = args.map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '\\"')}"` : a));
  const commandLine = `${cliPath} ${command} ${quoted.join(" ")}`.trim();

  if (useTerminal) {
    const terminal = vscode.window.createTerminal({
      name: `SkDD: ${command}`,
      cwd: workspace.uri.fsPath,
    });
    terminal.sendText(commandLine);
    terminal.show();
    return;
  }

  await vscode.tasks.executeTask(
    new vscode.Task(
      { type: "skdd", command },
      workspace,
      `skdd ${command}`,
      "skdd",
      new vscode.ShellExecution(commandLine, { cwd: workspace.uri.fsPath }),
    ),
  );
}
