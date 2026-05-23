interface SkeletonProps {
  variant?: "text" | "card" | "circle";
  width?: string | number;
  height?: string | number;
  count?: number;
}

export function Skeleton({ variant = "text", width, height, count = 1 }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (variant === "card") {
    return (
      <div
        className="skeleton-shimmer"
        role="presentation"
        aria-hidden="true"
        style={{
          width: width || "100%",
          height: height || 120,
          background: "linear-gradient(90deg, var(--bg-tertiary) 25%, var(--border) 50%, var(--bg-tertiary) 75%)",
          backgroundSize: "200% 100%",
          borderRadius: "8px",
          animation: "shimmer 1.5s infinite",
        }}
      />
    );
  }

  if (variant === "circle") {
    return (
      <div
        className="skeleton-shimmer"
        role="presentation"
        aria-hidden="true"
        style={{
          width: width || 40,
          height: height || 40,
          borderRadius: "50%",
          background: "linear-gradient(90deg, var(--bg-tertiary) 25%, var(--border) 50%, var(--bg-tertiary) 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
        }}
      />
    );
  }

  return (
    <div role="status" aria-busy="true" aria-label="加载中">
      {items.map((i) => (
        <div
          key={i}
          className="skeleton-shimmer"
          aria-hidden="true"
          style={{
            width: width || "100%",
            height: height || 14,
            marginBottom: 8,
            background: "linear-gradient(90deg, var(--bg-tertiary) 25%, var(--border) 50%, var(--bg-tertiary) 75%)",
            backgroundSize: "200% 100%",
            borderRadius: "4px",
            animation: "shimmer 1.5s infinite",
          }}
        />
      ))}
    </div>
  );
}
