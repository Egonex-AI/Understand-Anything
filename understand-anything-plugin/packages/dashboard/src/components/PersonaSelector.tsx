import { useTranslation } from "react-i18next";
import { useDashboardStore } from "../store";
import type { Persona } from "../store";

const personas: { id: Persona; labelKey: string; descriptionKey: string }[] = [
  {
    id: "non-technical",
    labelKey: "persona.overview",
    descriptionKey: "persona.overviewDesc",
  },
  {
    id: "junior",
    labelKey: "persona.learn",
    descriptionKey: "persona.learnDesc",
  },
  {
    id: "experienced",
    labelKey: "persona.deepDive",
    descriptionKey: "persona.deepDiveDesc",
  },
];

export default function PersonaSelector() {
  const { t } = useTranslation();
  const persona = useDashboardStore((s) => s.persona);
  const setPersona = useDashboardStore((s) => s.setPersona);

  return (
    <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5">
      {personas.map((p) => (
        <button
          key={p.id}
          onClick={() => setPersona(p.id)}
          title={t(p.descriptionKey)}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            persona === p.id
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:text-text-secondary hover:bg-surface"
          }`}
        >
          {t(p.labelKey)}
        </button>
      ))}
    </div>
  );
}
