const root = new URL("../..", import.meta.url).pathname;
const children = [
  Bun.spawn(["bun", "--watch", "server/src/main.ts"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  }),
  Bun.spawn(["bun", "run", "--cwd", "web", "dev"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  }),
];
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));

export {};
