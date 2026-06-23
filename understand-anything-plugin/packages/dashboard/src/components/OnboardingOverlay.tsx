import { useEffect, useState } from "react";
import { useI18n } from "../contexts/I18nContext";

/**
 * First-visit onboarding overlay (controlled).
 *
 * Parent owns the visibility + persistence state (see App.tsx). This component
 * only renders the modal and reports the user's intent via onDismiss:
 *   - onDismiss(true)  → "Skip" / Finish — parent should persist.
 *   - onDismiss(false) → backdrop click / Escape — parent should close without persisting.
 *
 * Force-show is handled by the parent (see `shouldShowOnboarding` in App.tsx).
 */

interface Props {
  onDismiss: (remember: boolean) => void;
}

const TITLE_ID = "ua-onboarding-title";

export default function OnboardingOverlay({ onDismiss }: Props) {
  const { t } = useI18n();
  const STEPS = t.onboarding.steps;
  const [stepIdx, setStepIdx] = useState(0);

  // Capture-phase Escape handler — runs before the global keydown chain so we
  // can stopPropagation() and prevent it from also firing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onDismiss]);

  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;
  const step = STEPS[stepIdx];

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss(false);
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        style={cardStyle}
      >
        <div style={tagStyle}>
          <span style={numStyle}>0{stepIdx + 1}</span>
          <span> / 0{STEPS.length}</span>
          <span style={dotStyle} />
          <span>{t.onboarding.header}</span>
        </div>

        <h2 id={TITLE_ID} style={titleStyle}>
          {step.title}
        </h2>
        <p style={bodyStyle}>{step.body}</p>
        {step.hint && (
          <blockquote style={hintStyle}>
            <span style={{ color: "var(--color-accent)", marginRight: 8 }}>·</span>
            {step.hint}
          </blockquote>
        )}

        <div style={progressTrackStyle}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                ...dotProgressStyle,
                background:
                  i === stepIdx
                    ? "var(--color-accent)"
                    : "var(--color-border-medium)",
                width: i === stepIdx ? 28 : 6,
              }}
            />
          ))}
        </div>

        <div style={btnRowStyle}>
          <button
            type="button"
            onClick={() => onDismiss(true)}
            style={{ ...btnStyle, ...btnGhostStyle }}
          >
            {t.onboarding.skipForever}
          </button>
          <div style={{ flex: 1 }} />
          {!isFirst && (
            <button
              type="button"
              onClick={() => setStepIdx(stepIdx - 1)}
              style={{ ...btnStyle, ...btnGhostStyle }}
            >
              {t.onboarding.prev}
            </button>
          )}
          {!isLast ? (
            <button
              type="button"
              onClick={() => setStepIdx(stepIdx + 1)}
              style={{ ...btnStyle, ...btnPrimaryStyle }}
            >
              {t.onboarding.next}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDismiss(true)}
              style={{ ...btnStyle, ...btnPrimaryStyle }}
            >
              {t.onboarding.finish}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const KEYFRAMES = `@keyframes ua-fade-in { from { opacity: 0 } to { opacity: 1 } }`;

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.78)",
  backdropFilter: "blur(6px)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontFamily: "var(--font-sans)",
  animation: "ua-fade-in 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
};

const cardStyle: React.CSSProperties = {
  background: "var(--color-elevated)",
  color: "var(--color-text-primary)",
  maxWidth: 580,
  width: "100%",
  padding: "48px 48px 36px",
  border: "1px solid var(--color-border-subtle)",
  borderTop: "2px solid var(--color-accent)",
  position: "relative",
};

const tagStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  letterSpacing: "0.3em",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  marginBottom: 24,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 4,
};

const numStyle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  color: "var(--color-accent)",
  fontSize: "0.9rem",
  letterSpacing: "0.1em",
  marginRight: 4,
};

const dotStyle: React.CSSProperties = {
  width: 4,
  height: 4,
  background: "var(--color-accent)",
  borderRadius: "50%",
  margin: "0 12px",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.7rem",
  fontWeight: 400,
  letterSpacing: "0.02em",
  lineHeight: 1.3,
  marginBottom: 16,
  color: "var(--color-text-primary)",
};

const bodyStyle: React.CSSProperties = {
  fontSize: "0.98rem",
  lineHeight: 1.7,
  color: "var(--color-text-secondary)",
  marginBottom: 0,
};

const hintStyle: React.CSSProperties = {
  margin: "20px 0 0",
  padding: "12px 18px",
  borderLeft: "2px solid var(--color-border-medium)",
  background: "var(--color-accent-overlay-bg)",
  fontSize: "0.86rem",
  color: "var(--color-accent)",
  fontStyle: "italic",
};

const progressTrackStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 36,
  marginBottom: 28,
};

const dotProgressStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  transition: "width 0.5s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s",
};

const btnRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const btnStyle: React.CSSProperties = {
  padding: "10px 22px",
  fontSize: "0.82rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  border: "1px solid",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
  fontWeight: 400,
};

const btnGhostStyle: React.CSSProperties = {
  background: "transparent",
  borderColor: "var(--color-border-medium)",
  color: "var(--color-text-muted)",
};

const btnPrimaryStyle: React.CSSProperties = {
  background: "var(--color-accent)",
  borderColor: "var(--color-accent)",
  color: "var(--color-root)",
  fontWeight: 500,
};
