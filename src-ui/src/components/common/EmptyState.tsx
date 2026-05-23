interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: "default" | "queue" | "logs" | "commits" | "lessons";
}

function DefaultIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="16" y="20" width="48" height="40" rx="4" stroke="var(--blue)" strokeWidth="1.5" fill="none" opacity="0.3" />
      <path d="M28 36h24M28 44h16" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      <circle cx="40" cy="40" r="12" stroke="var(--blue)" strokeWidth="1.5" fill="none" opacity="0.2">
        <animate attributeName="r" values="12;14;12" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.2;0.35;0.2" dur="3s" repeatCount="indefinite" />
      </circle>
      <line x1="48" y1="48" x2="56" y2="56" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}

function QueueIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="12" y="16" width="56" height="14" rx="3" stroke="var(--blue)" strokeWidth="1.2" fill="none" opacity="0.2">
        <animate attributeName="opacity" values="0.2;0.4;0.2" dur="2.5s" repeatCount="indefinite" />
      </rect>
      <rect x="12" y="34" width="56" height="14" rx="3" stroke="var(--purple)" strokeWidth="1.2" fill="none" opacity="0.2">
        <animate attributeName="opacity" values="0.2;0.4;0.2" dur="2.5s" begin="0.4s" repeatCount="indefinite" />
      </rect>
      <rect x="12" y="52" width="56" height="14" rx="3" stroke="var(--text-secondary)" strokeWidth="1.2" fill="none" opacity="0.15">
        <animate attributeName="opacity" values="0.15;0.3;0.15" dur="2.5s" begin="0.8s" repeatCount="indefinite" />
      </rect>
      <line x1="24" y1="23" x2="52" y2="23" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <line x1="24" y1="41" x2="44" y2="41" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <line x1="24" y1="59" x2="48" y2="59" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
}

function LogsIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="12" y="10" width="56" height="60" rx="4" stroke="var(--border)" strokeWidth="1.2" fill="none" opacity="0.3" />
      <line x1="20" y1="22" x2="50" y2="22" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3">
        <animate attributeName="x2" values="50;56;50" dur="2s" repeatCount="indefinite" />
      </line>
      <line x1="20" y1="32" x2="44" y2="32" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      <line x1="20" y1="42" x2="52" y2="42" stroke="var(--yellow)" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
      <line x1="20" y1="52" x2="38" y2="52" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.15" />
      <rect x="18" y="16" width="2" height="42" rx="1" fill="var(--green)" opacity="0.15">
        <animate attributeName="height" values="0;42" dur="1.5s" fill="freeze" />
      </rect>
    </svg>
  );
}

function CommitsIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="40" cy="24" r="8" stroke="var(--green)" strokeWidth="1.5" fill="none" opacity="0.3" />
      <circle cx="28" cy="48" r="8" stroke="var(--blue)" strokeWidth="1.5" fill="none" opacity="0.25" />
      <circle cx="52" cy="48" r="8" stroke="var(--purple)" strokeWidth="1.5" fill="none" opacity="0.2" />
      <line x1="40" y1="32" x2="28" y2="40" stroke="var(--text-secondary)" strokeWidth="1.2" opacity="0.2" />
      <line x1="40" y1="32" x2="52" y2="40" stroke="var(--text-secondary)" strokeWidth="1.2" opacity="0.2" />
      <line x1="36" y1="24" x2="44" y2="24" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <line x1="24" y1="48" x2="32" y2="48" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <line x1="48" y1="48" x2="56" y2="48" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}

function LessonsIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M40 16 L56 28 L56 52 C56 56 48 62 40 66 C32 62 24 56 24 52 L24 28 Z" stroke="var(--yellow)" strokeWidth="1.5" fill="none" opacity="0.25">
        <animate attributeName="opacity" values="0.25;0.4;0.25" dur="3s" repeatCount="indefinite" />
      </path>
      <line x1="32" y1="36" x2="48" y2="36" stroke="var(--yellow)" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
      <line x1="32" y1="44" x2="44" y2="44" stroke="var(--yellow)" strokeWidth="1.2" strokeLinecap="round" opacity="0.25" />
      <line x1="32" y1="52" x2="40" y2="52" stroke="var(--yellow)" strokeWidth="1.2" strokeLinecap="round" opacity="0.2" />
      <circle cx="40" cy="26" r="3" fill="var(--yellow)" opacity="0.3">
        <animate attributeName="r" values="3;4;3" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

const illustrations = {
  default: DefaultIllustration,
  queue: QueueIllustration,
  logs: LogsIllustration,
  commits: CommitsIllustration,
  lessons: LessonsIllustration,
};

export function EmptyState({ title, description, action, variant = "default" }: EmptyStateProps) {
  const Illustration = illustrations[variant] || DefaultIllustration;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <div style={{ marginBottom: "16px", opacity: 0.8 }}>
        <Illustration />
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 4px" }}>
        {title}
      </p>
      {description && (
        <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: 0, opacity: 0.7 }}>
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: "16px",
            padding: "6px 16px",
            background: "var(--blue)",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
