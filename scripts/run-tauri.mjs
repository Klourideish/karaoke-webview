import { spawn } from "node:child_process";
import { delimiter, join } from "node:path";
import { platform } from "node:process";

const args = process.argv.slice(2);
const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const pathValue = process.env.PATH ?? "";
const command =
  platform === "win32"
    ? join(process.cwd(), "node_modules", ".bin", "tauri.cmd")
    : join(process.cwd(), "node_modules", ".bin", "tauri");

const child = spawn([command, ...args].join(" "), {
  env: {
    ...process.env,
    PATH: `${cargoBin}${delimiter}${pathValue}`,
  },
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }

  process.exit(code ?? 1);
});
