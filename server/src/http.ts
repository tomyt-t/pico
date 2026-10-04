import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { AgentCatalog } from "./agent-catalog";
import type { AgentResources } from "./agent-resources";
import type { Campaigns } from "./campaigns";
import type { PicoPaths } from "./config";
import type {
  AgentDefinitionPatch,
  AgentSkill,
  CampaignControl,
  CampaignSettings,
  CreateCampaignInput,
  ReviewPageInput,
  SavePageInput,
} from "./contracts";
import type { Editorial } from "./editorial";
import { badRequest, errorMessage, HttpError, notFound } from "./errors";
import type { Jobs } from "./jobs";
import type { CreateLabInput, LabPatch, Labs } from "./labs";
import type { Records, SaveRecordInput } from "./records";
import type { LabSessions, SessionEvent } from "./sessions";
import type { Subagents } from "./subagents";

export interface ApiDependencies {
  paths: PicoPaths;
  labs: Labs;
  records: Records;
  editorial: Editorial;
  jobs: Jobs;
  sessions: LabSessions;
  catalog: AgentCatalog;
  resources: AgentResources;
  subagents: Subagents;
  campaigns: Campaigns;
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest("Invalid JSON body");
  }
}

function guardOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, "Cross-origin writes are not allowed");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"];
  if (parsed.host !== url.host && !local.includes(parsed.hostname))
    throw new HttpError(403, "Cross-origin writes are not allowed");
}

function insideLab(labPath: string, requested: string | null): string {
  const target = resolve(labPath, requested ?? ".");
  if (target !== labPath && !target.startsWith(`${labPath}${sep}`))
    throw badRequest("Path is outside the laboratory");
  return target;
}

/** Types the browser may render inline. HTML is served as text: a page saved
 *  from the web must never run scripts on Pico's origin. */
const inlineTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
};

function rawFile(target: string, download: boolean): Response {
  if (!existsSync(target) || !statSync(target).isFile())
    throw notFound("File not found");
  const name = basename(target);
  const extension = extname(name).toLowerCase();
  const type = inlineTypes[extension] ?? "application/octet-stream";
  return new Response(Bun.file(target), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${download || type === "application/octet-stream" ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    },
  });
}

async function fileView(labPath: string, target: string) {
  if (!existsSync(target)) throw notFound("Path not found");
  const info = statSync(target);
  const path = relative(labPath, target) || ".";
  if (info.isDirectory()) {
    const items = await readdir(target, { withFileTypes: true });
    const entries = items
      .filter((item) => item.name !== ".git")
      .map((item) => {
        const full = join(target, item.name);
        const stat = statSync(full, { throwIfNoEntry: false });
        return {
          name: item.name,
          kind: item.isDirectory() ? "directory" : "file",
          size: stat?.size ?? 0,
          modifiedAt: stat?.mtime.toISOString() ?? null,
        };
      })
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "directory"
            ? -1
            : 1,
      );
    return { kind: "directory", path, entries };
  }
  const limit = 2 * 1024 * 1024;
  const bytes = await readFile(target);
  const sample = bytes.subarray(0, 8192);
  const binary = sample.includes(0);
  return {
    kind: "file",
    path,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    binary,
    truncated: !binary && bytes.length > limit,
    content: binary ? null : bytes.subarray(0, limit).toString("utf8"),
  };
}

function eventStream(
  deps: ApiDependencies,
  labId: string,
  request: Request,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SessionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const cleanup = () => {
        closed = true;
        unsubscribe?.();
        if (keepalive) clearInterval(keepalive);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      try {
        send({ type: "state", state: await deps.sessions.state(labId) });
        unsubscribe = await deps.sessions.subscribe(labId, send);
      } catch (error) {
        send({ type: "error", message: errorMessage(error) });
      }
      keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (keepalive) clearInterval(keepalive);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function createApi(
  deps: ApiDependencies,
): (request: Request) => Promise<Response> {
  const {
    labs,
    records,
    jobs,
    sessions,
    catalog,
    subagents,
    editorial,
    resources,
    campaigns,
  } = deps;

  async function route(
    request: Request,
    url: URL,
  ): Promise<Response | undefined> {
    const parts = url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    const method = request.method;
    const [head, labId, resource, itemId, action] = parts;

    if (head === "health" && method === "GET")
      return json({
        ok: true,
        dataDir: deps.paths.dataDir,
        labsDir: deps.paths.labsDir,
      });
    if (head === "models" && method === "GET")
      return json(await sessions.models());
    if (head === "campaign-settings") {
      if (method === "GET") return json(campaigns.settings());
      if (method === "PATCH")
        return json(
          campaigns.configure(await body<Partial<CampaignSettings>>(request)),
        );
      return undefined;
    }
    if (head === "agents") {
      if (!labId && method === "GET") return json(catalog.list());
      if (labId && !resource && method === "PATCH")
        return json(
          await catalog.update(
            labId,
            await body<AgentDefinitionPatch>(request),
          ),
        );
      return undefined;
    }
    if (head === "skills") {
      if (method === "GET")
        return json(labId ? resources.skill(labId) : resources.skills());
      if (labId && method === "PATCH")
        return json(
          resources.updateSkill(
            labId,
            await body<Partial<AgentSkill>>(request),
          ),
        );
      return undefined;
    }
    if (head === "prompts") {
      if (method === "GET")
        return json(labId ? resources.prompt(labId) : resources.prompts());
      if (labId && method === "PATCH")
        return json(
          resources.updatePrompt(
            labId,
            (await body<{ content: string }>(request))?.content,
          ),
        );
      return undefined;
    }
    if (head !== "labs") return undefined;

    if (!labId) {
      if (method === "GET") return json(labs.list());
      if (method === "POST")
        return json(
          await labs.create(await body<CreateLabInput>(request)),
          201,
        );
      return undefined;
    }
    const lab = labs.get(labId);

    if (!resource) {
      if (method === "GET") return json(lab);
      if (method === "PATCH") {
        const patch = await body<LabPatch>(request);
        const updated = labs.update(lab.id, patch);
        await sessions.setModel(lab.id, {
          provider: updated.provider,
          model: updated.model,
          thinking: patch.thinking,
        });
        return json(updated);
      }
      return undefined;
    }

    if (resource === "state" && method === "GET")
      return json(await sessions.state(lab.id));

    if (resource === "campaigns") {
      if (itemId && action === "message" && method === "POST")
        return json(
          campaigns.message(
            lab.id,
            itemId,
            (await body<{ message: string }>(request))?.message,
          ),
        );
      if (!itemId && method === "GET")
        return json(
          campaigns.list(lab.id, url.searchParams.get("active") === "1"),
        );
      if (!itemId && method === "POST")
        return json(
          campaigns.start(lab, await body<CreateCampaignInput>(request)),
          202,
        );
      if (itemId && !action && method === "GET")
        return json(
          await campaigns.detail(lab.id, itemId, {
            ...(url.searchParams.has("before") && {
              before: Number(url.searchParams.get("before")),
            }),
            ...(url.searchParams.has("limit") && {
              limit: Number(url.searchParams.get("limit")),
            }),
          }),
        );
      if (itemId && action === "control" && method === "POST")
        return json(
          await campaigns.control(
            lab.id,
            itemId,
            await body<CampaignControl>(request),
          ),
        );
      return undefined;
    }

    if (resource === "editorial" && !itemId) {
      if (method === "GET") return json(editorial.status(lab));
      if (method === "POST") {
        const input = await body<{ runId: string; pages: ReviewPageInput[] }>(
          request,
        );
        return json(editorial.review(lab, input?.runId, input?.pages));
      }
    }

    if (resource === "pages" && !itemId && method === "POST")
      return json(
        records.savePage(
          lab.id,
          await body<SavePageInput>(request),
          "researcher",
        ),
      );

    if (resource === "agent-runs") {
      if (!itemId && method === "GET")
        return json(
          subagents.list(lab.id, url.searchParams.get("active") === "1"),
        );
      if (!itemId && method === "POST") {
        const input = await body<{ agentId: string; task: string }>(request);
        return json(subagents.start(lab, input?.agentId, input?.task), 202);
      }
      if (itemId && !action && method === "GET")
        return json(
          await subagents.detail(lab.id, itemId, {
            ...(url.searchParams.has("before") && {
              before: Number(url.searchParams.get("before")),
            }),
            ...(url.searchParams.has("limit") && {
              limit: Number(url.searchParams.get("limit")),
            }),
          }),
        );
      if (itemId && action === "stop" && method === "POST")
        return json(await subagents.stop(lab.id, itemId));
      if (itemId && action === "resume" && method === "POST")
        return json(
          subagents.resume(
            lab,
            itemId,
            (await body<{ message?: string }>(request))?.message,
          ),
          202,
        );
      return undefined;
    }

    if (resource === "chat") {
      if (!itemId && method === "GET")
        return json({
          state: await sessions.state(lab.id),
          ...(await sessions.messagePage(lab.id, {
            ...(url.searchParams.has("before") && {
              before: Number(url.searchParams.get("before")),
            }),
            ...(url.searchParams.has("limit") && {
              limit: Number(url.searchParams.get("limit")),
            }),
          })),
        });
      if (!itemId && method === "POST") {
        const { message } = await body<{ message: string }>(request);
        return json(await sessions.send(lab.id, message ?? ""), 202);
      }
      if (itemId === "abort" && method === "POST") {
        await sessions.abort(lab.id);
        return json({ ok: true });
      }
      return undefined;
    }

    if (resource === "events" && method === "GET")
      return eventStream(deps, lab.id, request);

    if (resource === "history" && !itemId && method === "GET")
      return json(
        records.history(lab.id, {
          kind: url.searchParams.get("kind") ?? undefined,
          limit: url.searchParams.has("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
        }),
      );

    if (resource === "records") {
      if (!itemId && method === "GET")
        return json(
          records.list(lab.id, {
            kind: url.searchParams.get("kind") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            limit: Number(url.searchParams.get("limit")) || undefined,
          }),
        );
      if (!itemId && method === "POST")
        return json(
          records.save(
            lab.id,
            await body<SaveRecordInput>(request),
            "researcher",
          ),
          201,
        );
      if (itemId && method === "GET")
        return json({
          record: records.get(lab.id, itemId),
          revisions: records.revisions(lab.id, itemId),
        });
      if (itemId && method === "PATCH") {
        const patch = await body<Omit<SaveRecordInput, "id" | "kind">>(request);
        const current = records.get(lab.id, itemId);
        return json(
          records.save(
            lab.id,
            { ...patch, id: itemId, kind: current.kind },
            "researcher",
          ),
        );
      }
      if (itemId && method === "DELETE") {
        records.remove(lab.id, itemId);
        return json({ ok: true });
      }
      return undefined;
    }

    if (resource === "jobs") {
      if (!itemId && method === "GET")
        return json(
          jobs.list(lab.id, url.searchParams.get("status") ?? undefined),
        );
      if (itemId && !action && method === "GET") {
        const job = jobs.get(lab.id, itemId);
        return json({ job, log: await jobs.logTail(job) });
      }
      if (itemId && action === "stop" && method === "POST")
        return json(await jobs.stop(lab.id, itemId));
      return undefined;
    }

    if (
      resource === "files" &&
      itemId === "raw" &&
      (method === "GET" || method === "HEAD")
    )
      return rawFile(
        insideLab(lab.path, url.searchParams.get("path")),
        url.searchParams.get("download") === "1",
      );
    if (resource === "files" && method === "GET")
      return json(
        await fileView(
          lab.path,
          insideLab(lab.path, url.searchParams.get("path")),
        ),
      );

    if (resource === "context" || resource === "pico") {
      if (method === "GET" && itemId === "history")
        return json(labs.contextHistory(lab.id));
      if (method === "GET" && !itemId) return json(labs.context(lab.id));
      if (method === "PUT" && !itemId) {
        const input = await body<{ content: string }>(request);
        return json(labs.saveContext(lab.id, input?.content, "researcher"));
      }
    }
    return undefined;
  }

  return async (request) => {
    const url = new URL(request.url);
    try {
      if (request.method !== "GET" && request.method !== "HEAD")
        guardOrigin(request, url);
      const response = await route(request, url);
      return response ?? json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      console.error(`[pico] ${request.method} ${url.pathname}:`, error);
      return json({ error: errorMessage(error) }, 500);
    }
  };
}
