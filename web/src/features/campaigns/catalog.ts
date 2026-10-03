import { i18n } from "@/web/components/i18n";

/** The catalog as seeded by the server; a profile the researcher renamed keeps its stored name. */
export const profileDefaults = {
  "campaign-coordinator": {
    name: "Campaign Coordinator",
    description:
      "Pursue a bounded research objective with a persistent session and specialist agents.",
  },
  bibliography: {
    name: "Literature Researcher",
    description:
      "Find and compare sources, methods, evidence and research gaps.",
  },
  experimentation: {
    name: "Experimenter",
    description:
      "Design experiments, prepare data, implement and run protocols.",
  },
  "critical-analysis": {
    name: "Critical Analyst",
    description: "Develop hypotheses, review protocols and assess evidence.",
  },
  "research-editor": {
    name: "Research Editor",
    description: "Explain research and maintain the Panorama and topic pages.",
  },
} as const;

type ProfileId = keyof typeof profileDefaults;

const isProfile = (id: string): id is ProfileId => id in profileDefaults;

/** The profile name in the researcher's language, unless they renamed it. */
export function profileName(id: string, name: string): string {
  return isProfile(id) && profileDefaults[id].name === name
    ? i18n.t(`agents.catalog.${id}.name`)
    : name;
}

export function profileDescription(id: string, description: string): string {
  return isProfile(id) && profileDefaults[id].description === description
    ? i18n.t(`agents.catalog.${id}.description`)
    : description;
}
