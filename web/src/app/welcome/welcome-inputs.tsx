"use client";

import { useState } from "react";
import { careerStages, industryPreferences, type CareerStage } from "@/types";
import { industryLabels, type ChoiceOption, type ChoiceValue } from "@/components/profile/field-kit";

function StageIcon({ kind }: { kind: "undergraduate" | "masters" | "phd" | "postdoc" | "scientist" }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "undergraduate" ? <><path d="M5 8c4-2 8-2 11 1v16c-3-3-7-3-11-1V8ZM27 8c-4-2-8-2-11 1v16c3-3 7-3 11-1V8Z" /></> : kind === "masters" ? <><path d="M7 7h18v18H7zM11 12h10M11 16h7M11 20h5" /><path d="M4 10v17h18" /></> : kind === "phd" ? <><path d="M4 12 16 6l12 6-12 6-12-6Z" /><path d="M9 15v6c4 3 10 3 14 0v-6M28 12v8" /></> : kind === "postdoc" ? <><circle cx="16" cy="16" r="4" /><path d="M6 16c0-6 4-11 10-11s10 5 10 11-4 11-10 11S6 22 6 16Z" /><path d="M5 12c4-3 18-3 22 0M5 20c4 3 18 3 22 0" /></> : <><path d="M12 5h8M14 5v8L8 24a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-11V5M11 21h10" /><circle cx="16" cy="18" r="1" /></>}
    </svg>
  );
}

/** Each choice writes the same stage value used by the profile. */
export function CareerStagePicker({ value, onChange }: { value: CareerStage; onChange: (value: CareerStage) => void }) {
  const isPhd = value.startsWith("PhD Year ");
  const [lastYear, setLastYear] = useState<CareerStage>(isPhd ? value : "PhD Year 3");
  const stages = [
    { label: "Undergraduate", kind: "undergraduate" as const, active: value === "Undergraduate", choose: () => onChange("Undergraduate") },
    { label: "Master's student", kind: "masters" as const, active: value === "Master's student", choose: () => onChange("Master's student") },
    { label: "PhD", kind: "phd" as const, active: isPhd, choose: () => onChange(lastYear) },
    { label: "Postdoc", kind: "postdoc" as const, active: value === "Postdoc", choose: () => onChange("Postdoc") },
    { label: "Research scientist", kind: "scientist" as const, active: value === "Research Scientist", choose: () => onChange("Research Scientist") },
  ];
  return (
    <div>
      <div className="welcome-stage-grid" role="group" aria-label="Career stage">
        {stages.map((stage) => (
          <button key={stage.kind} type="button" aria-pressed={stage.active} onClick={stage.choose} className="welcome-stage-card">
            <span className="welcome-stage-icon"><StageIcon kind={stage.kind} /></span>
            <span>{stage.label}</span>
            <span className="welcome-option-indicator" aria-hidden>{stage.active ? "✓" : ""}</span>
          </button>
        ))}
      </div>
      {isPhd && (
        <div className="welcome-year-picker" role="group" aria-label="PhD year">
          <div className="welcome-year-label"><span>PhD year</span><span>{value.replace("PhD Year ", "Year ")}</span></div>
          <div className="welcome-year-track">
            {careerStages.filter((stage) => stage.startsWith("PhD Year ")).map((stage, index) => (
              <button key={stage} type="button" aria-label={stage} aria-pressed={stage === value} className="welcome-year-step" onClick={() => { setLastYear(stage); onChange(stage); }}>
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectionIcon({ value }: { value: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {value === "academia" ? <><path d="m3 9 9-5 9 5M5 10h14M6 10v7m4-7v7m4-7v7m4-7v7M4 20h16" /></> :
       value === "industry" ? <><path d="M4 20V9l8-4v15M12 12l8-3v11M3 20h18M7 11v1m0 3v1m3-6v1m0 3v1m5 0v1m3-1v1" /></> :
       value === "both" ? <><circle cx="12" cy="12" r="8" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></> :
       value === "startups" ? <><path d="M9 15c-1-3 1-8 7-10 1 4-1 9-4 10l-3 0ZM9 15l-3 1-1 3 4-1m3-3 1 4 3-1 1-3M9 19l-2 2" /><circle cx="14" cy="9" r="1" /></> :
       <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3" /></>}
    </svg>
  );
}

export function DirectionPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="welcome-direction-grid" role="group" aria-label="Looking toward">
      {industryPreferences.map((direction) => (
        <button key={direction} type="button" aria-pressed={value === direction} onClick={() => onChange(direction)} className="welcome-direction-card">
          <span className="welcome-direction-icon"><DirectionIcon value={direction} /></span>
          <span>{industryLabels[direction] ?? direction}</span>
          <span className="welcome-option-indicator" aria-hidden>{value === direction ? "✓" : ""}</span>
        </button>
      ))}
    </div>
  );
}

/** Each choice combines a small visual with a short explanation of its effect. */
export function RadarPicker({ label, kind, value, options, onChange }: {
  label: string;
  kind: "focus" | "freshness" | "count";
  value: ChoiceValue;
  options: readonly ChoiceOption[];
  onChange: (value: ChoiceValue) => void;
}) {
  return (
    <div className="welcome-radar-field">
      <p className="welcome-field-label">{label}</p>
      <div className="welcome-radar-grid" role="group" aria-label={label}>
        {options.map((option, index) => (
          <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className="welcome-radar-card">
            <span className={`welcome-radar-visual is-${kind}`} aria-hidden>
              {kind === "count" ? <><i /><i /><i /><b>{option.label}</b></> : <><i /><i /><i /><b style={{ left: `${18 + index * 32}%` }} /></>}
            </span>
            <span className="welcome-radar-copy"><strong>{option.label}</strong>{option.help && <small>{option.help}</small>}</span>
            <span className="welcome-option-indicator" aria-hidden>{value === option.value ? "✓" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
