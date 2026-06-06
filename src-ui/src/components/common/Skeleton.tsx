interface SkeletonProps {
  variant?: "text" | "card" | "circle";
  width?: string | number;
  height?: string | number;
  count?: number;
}

const skeletonAria = {
  "aria-busy": "true",
  "aria-label": "加载中",
  "aria-valuenow": 0,
  "aria-valuemin": 0,
  "aria-valuemax": 100,
} as const;

export function Skeleton({ variant = "text", width, height, count = 1 }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (variant === "card") {
    return (
      <div
        className="skeleton-gradient"
        role="progressbar"
        {...skeletonAria}
        style={{
          width: width || "100%",
          height: height || 120,
          borderRadius: "var(--radius-md)",
        }}
      />
    );
  }

  if (variant === "circle") {
    return (
      <div
        className="skeleton-gradient"
        role="progressbar"
        {...skeletonAria}
        style={{
          width: width || 40,
          height: height || 40,
          borderRadius: "50%",
        }}
      />
    );
  }

  return (
    <>
      {items.map((i) => (
        <div
          key={i}
          className="skeleton-gradient"
          role="progressbar"
          {...skeletonAria}
          style={{
            width: width || "100%",
            height: height || 14,
            marginBottom: 8,
            borderRadius: "var(--radius-sm)",
          }}
        />
      ))}
    </>
  );
}
