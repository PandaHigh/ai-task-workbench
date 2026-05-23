import React from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: 16, md: 24, lg: 40 };

export function Spinner({ size = "md" }: SpinnerProps) {
  const s = SIZES[size];
  return (
    <div
      style={{
        width: s,
        height: s,
        border: `2px solid var(--border)`,
        borderTopColor: "var(--blue)",
        borderRadius: "50%",
        animation: "spin-slow 0.8s linear infinite",
      }}
      role="status"
      aria-label="加载中"
    />
  );
}
