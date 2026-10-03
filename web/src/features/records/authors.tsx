import type { AgentRun, Campaign } from "@pico/server/contracts";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { authorLabel } from "@/web/components/format";
import { profileName } from "@/web/features/campaigns/catalog";

const AuthorNames = createContext<Map<string, string>>(new Map());

/** Names for the run and campaign ids that records carry as authors. */
export function AuthorNamesProvider({
  labId,
  children,
}: {
  labId: string;
  children: ReactNode;
}) {
  const runs = usePoll<AgentRun[]>(labPath(labId, "/agent-runs"), 60_000);
  const campaigns = usePoll<Campaign[]>(labPath(labId, "/campaigns"), 60_000);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runs.data ?? [])
      map.set(run.id, profileName(run.agentId, run.name));
    for (const campaign of campaigns.data ?? [])
      map.set(campaign.id, campaign.title);
    return map;
  }, [runs.data, campaigns.data]);
  return <AuthorNames.Provider value={names}>{children}</AuthorNames.Provider>;
}

/** Turns a stored author ("pico", "subagent:run-x", "campaign:campaign-y") into a name. */
export function useAuthor(): (author: string) => string {
  const names = useContext(AuthorNames);
  return (author) => authorLabel(author, names);
}
