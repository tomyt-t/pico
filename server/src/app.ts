import type { Database } from "bun:sqlite";
import { AgentCatalog } from "./agent-catalog";
import { AgentResources } from "./agent-resources";
import { Campaigns } from "./campaigns";
import { useClaudeConfigDir } from "./claude-auth";
import {
  type PathOverrides,
  type PicoPaths,
  picoPaths,
  preparePaths,
} from "./config";
import { openDatabase } from "./db";
import { Editorial } from "./editorial";
import { createApi } from "./http";
import { type Job, Jobs, jobNotification } from "./jobs";
import { Labs } from "./labs";
import { Records } from "./records";
import { LabSessions } from "./sessions";
import { Subagents, subagentNotification } from "./subagents";

export interface App {
  paths: PicoPaths;
  db: Database;
  labs: Labs;
  records: Records;
  editorial: Editorial;
  jobs: Jobs;
  sessions: LabSessions;
  catalog: AgentCatalog;
  resources: AgentResources;
  subagents: Subagents;
  campaigns: Campaigns;
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

export interface AppOptions extends PathOverrides {
  pollMs?: number;
}

export function createApp(options: AppOptions = {}): App {
  const paths = picoPaths(options);
  preparePaths(paths);
  useClaudeConfigDir(paths.claudeConfigDir);
  const db = openDatabase(paths.databasePath);
  const resources = new AgentResources(db);
  const labs = new Labs(db, paths, resources);
  const records = new Records(db);
  const editorial = new Editorial(db, records);
  const jobs = new Jobs(db, {
    pollMs: options.pollMs,
    beforeStart: (labId, campaignId) => {
      if (campaignId) campaigns.assertRunnable(labId, campaignId);
    },
    onFinished: async (job: Job) =>
      job.campaignId
        ? campaigns.receive(
            job.labId,
            job.campaignId,
            job.id,
            await jobNotification(job),
          )
        : sessions.deliverSubagentResult(job.labId, await jobNotification(job)),
  });
  const catalog = new AgentCatalog(db, () => sessions.models(), resources);
  const subagents = new Subagents(db, {
    catalog,
    editorial,
    beforeStart: (labId, campaignId) => campaigns.admitAgent(labId, campaignId),
    createSession: (lab, run, definition) =>
      sessions.createSession(lab, { run, definition }),
    onFinished: (run) =>
      run.campaignId
        ? campaigns.receive(
            run.labId,
            run.campaignId,
            run.id,
            subagentNotification(run),
          )
        : sessions.deliverSubagentResult(run.labId, subagentNotification(run)),
  });
  const campaigns = new Campaigns(db, {
    labs,
    catalog,
    resources,
    subagents,
    jobs,
    createSession: (lab, campaign) =>
      sessions.createSession(lab, undefined, campaign),
    notify: (labId, text) => sessions.deliverSubagentResult(labId, text),
  });
  const sessions = new LabSessions({
    paths,
    labs,
    records,
    editorial,
    jobs,
    catalog,
    resources,
    subagents,
    campaigns,
  });
  jobs.startPolling();
  subagents.startPolling();
  campaigns.startPolling();
  return {
    paths,
    db,
    labs,
    records,
    editorial,
    jobs,
    sessions,
    catalog,
    resources,
    subagents,
    campaigns,
    fetch: createApi({
      paths,
      labs,
      records,
      editorial,
      jobs,
      sessions,
      catalog,
      resources,
      subagents,
      campaigns,
    }),
    close: async () => {
      jobs.stopPolling();
      await campaigns.close();
      await subagents.close();
      await jobs.close();
      await sessions.close();
      db.close();
    },
  };
}
