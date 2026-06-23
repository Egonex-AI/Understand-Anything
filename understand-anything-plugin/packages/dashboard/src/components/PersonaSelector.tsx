import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { Persona } from "../store";

export default function PersonaSelector() {
  const persona = useDashboardStore((s) => s.persona);
  const setPersona = useDashboardStore((s) => s.setPersona);
  const { t } = useI18n();

  const personas: { id: Persona; label: string; description: string }[] = [
    {
      id: "non-technical",
      label: t.personaSelector.overview,
      description: t.personaSelector.overviewDesc,
    },
    {
      id: "junior",
      label: t.personaSelector.learn,
      description: t.personaSelector.learnDesc,
    },
    {
      id: "experienced",
      label: t.personaSelector.deepDive,
      description: t.personaSelector.deepDiveDesc,
    },
  ];

  return (
    <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5">
      {personas.map((p) => (
        <button
          key={p.id}
          onClick={() => setPersona(p.id)}
          title={p.description}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            persona === p.id
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:text-text-secondary hover:bg-surface"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
