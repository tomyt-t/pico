import { createLabRuntime, type LabRuntimeOptions } from "@pico/lab";

export async function createRuntime(options: LabRuntimeOptions) {
  const runtime = createLabRuntime(options);
  await runtime.start();
  return runtime;
}
