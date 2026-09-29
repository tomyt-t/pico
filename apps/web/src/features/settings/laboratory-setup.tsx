import type { Lab } from "@pico/lab/contracts";
import { LabForm } from "@/web/features/settings/laboratory-form";

export function Setup({ onCreated }: { onCreated: (lab: Lab) => void }) {
  return (
    <div className="setup">
      <main className="setup-card">
        <div className="brand">
          <span className="pico-mark">p</span>Pico
        </div>
        <h1>A place to investigate together.</h1>
        <p className="subheading" style={{ marginBottom: 28 }}>
          Start a laboratory. One conversation connects questions, experiments
          and what you learn.
        </p>
        <LabForm onSaved={onCreated} />
      </main>
    </div>
  );
}
