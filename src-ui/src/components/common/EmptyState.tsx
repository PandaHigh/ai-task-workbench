interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
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
      <div
        style={{
          fontSize: "32px",
          marginBottom: "12px",
          opacity: 0.4,
          animation: "float 3s ease-in-out infinite",
        }}
      >
        ◎
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
