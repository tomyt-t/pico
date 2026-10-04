import type { Database } from "bun:sqlite";
import { now } from "./db";

/** SHA-256 prefixes of the factory defaults that named Pi's tools. Seeds never
 *  overwrite the database, so a stored text still equal to its old default is
 *  replaced by the current default; anything the researcher edited stays. */
const previous = {
  prompts: {
    campaign: "1c4eb71af1d25487",
    "campaign-wake": "3c4f5dde736a4610",
    "campaign-dispatch": "45e1e5524a0f6255",
    coordinator: "64b3bee9dea145f4",
    worker: "c1c30666d72432a6",
    shared: "3968c978e6a4bb04",
    "lab-context": "203ad098ae5c3d18",
  } as Record<string, string>,
  skills: {
    "campaign-coordination": {
      instructions: "e3df27e2e20c5a53",
      examples: "044ec48906b4b825",
    },
    "literature-review": {
      instructions: "41740597765c582a",
      examples: "eb572a3a769ba2f7",
    },
    "research-experiment": {
      instructions: "7145fc0e2d510bba",
      examples: "b14f9d1ab6d0e792",
    },
    "critical-review": {
      instructions: "b4359a070289a109",
      examples: "7c8a01403615cb3e",
    },
    "research-editorial": {
      instructions: "5270461784d8f5ad",
      examples: "b0ec678326935259",
    },
  } as Record<string, Record<string, string>>,
  agents: {
    "campaign-coordinator": {
      instructions: "f6a6056dfcedfa82",
      when_to_use: "58f38f55fb96fa74",
    },
    bibliography: {
      instructions: "e4d9e09921f55459",
      when_to_use: "6d25a3bc6f25b381",
    },
    experimentation: {
      instructions: "18890a509bbc6dc8",
      when_to_use: "5f8f853d706fefad",
    },
    "critical-analysis": {
      instructions: "b357ee4b7491cd9d",
      when_to_use: "ce2f4d85ae19693d",
    },
    "research-editor": {
      instructions: "99029f988196a636",
      when_to_use: "e755130c752007c5",
    },
  } as Record<string, Record<string, string>>,
};

export const defaultHash = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);

type Table = "prompt_templates" | "agent_skills" | "agent_definitions";

/** Replaces one column of one row only if it still holds the old default. */
function upgrade(
  db: Database,
  table: Table,
  id: string,
  column: string,
  oldHash: string | undefined,
  value: string,
): void {
  if (!oldHash) return;
  const row = db
    .query(`SELECT ${column} AS value FROM ${table} WHERE id = ?`)
    .get(id) as { value: string | null } | null;
  if (
    row?.value == null ||
    row.value === value ||
    defaultHash(row.value) !== oldHash
  )
    return;
  db.run(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE id = ?`, [
    value,
    now(),
    id,
  ]);
}

export function upgradePrompts(
  db: Database,
  prompts: readonly { id: string; content: string }[],
  skills: readonly { id: string; instructions: string; examples: string }[],
): void {
  for (const prompt of prompts)
    upgrade(
      db,
      "prompt_templates",
      prompt.id,
      "content",
      previous.prompts[prompt.id],
      prompt.content,
    );
  for (const skill of skills)
    for (const column of ["instructions", "examples"] as const)
      upgrade(
        db,
        "agent_skills",
        skill.id,
        column,
        previous.skills[skill.id]?.[column],
        skill[column],
      );
}

export function upgradeAgents(
  db: Database,
  profiles: readonly { id: string; instructions: string; whenToUse: string }[],
): void {
  for (const profile of profiles) {
    const hashes = previous.agents[profile.id];
    upgrade(
      db,
      "agent_definitions",
      profile.id,
      "instructions",
      hashes?.instructions,
      profile.instructions,
    );
    upgrade(
      db,
      "agent_definitions",
      profile.id,
      "when_to_use",
      hashes?.when_to_use,
      profile.whenToUse,
    );
  }
}
