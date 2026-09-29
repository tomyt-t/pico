const children = [
  Bun.spawn(["bun", "--watch", "apps/server/src/main.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  }),
  Bun.spawn(["bun", "run", "dev:web"], {
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
