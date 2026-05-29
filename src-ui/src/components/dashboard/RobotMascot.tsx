import type { RobotMood } from "@ai-workbench/shared";

interface RobotMascotProps {
  mood: RobotMood;
  size?: number;
}

export function RobotMascot({ mood, size = 56 }: RobotMascotProps) {
  const moodStyles: Record<RobotMood, { anim: string; eyeColor: string; glow: string }> = {
    idle: { anim: "", eyeColor: "var(--blue-light)", glow: "none" },
    thinking: { anim: "animate-pulse-slow", eyeColor: "var(--yellow)", glow: "none" },
    working: { anim: "", eyeColor: "var(--green)", glow: "none" },
    celebrating: { anim: "", eyeColor: "var(--green)", glow: "none" },
    error: { anim: "", eyeColor: "var(--red)", glow: "none" },
  };

  const style = moodStyles[mood];

  return (
    <div
      className={`inline-flex items-center justify-center ${style.anim}`}
      style={{
        width: size,
        height: size,
      }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={`Panda mascot, ${mood} mood`}>
        {/* Ears */}
        <rect x="6" y="2" width="10" height="10" rx="2" fill="#2d2d2d" />
        <rect x="32" y="2" width="10" height="10" rx="2" fill="#2d2d2d" />
        {/* Head */}
        <rect x="8" y="6" width="32" height="22" rx="6" fill="#f0f0f0" stroke="#2d2d2d" strokeWidth="1" />
        {/* Eye patches */}
        <rect x="11" y="12" width="9" height="7" rx="2.5" fill="#2d2d2d" />
        <rect x="28" y="12" width="9" height="7" rx="2.5" fill="#2d2d2d" />
        {/* Eyes */}
        <circle cx="15.5" cy="15" r="2" fill={style.eyeColor}>
          {mood === "thinking" && (
            <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
          )}
        </circle>
        <circle cx="32.5" cy="15" r="2" fill={style.eyeColor}>
          {mood === "thinking" && (
            <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.5s" />
          )}
        </circle>
        {/* Nose */}
        <ellipse cx="24" cy="22" rx="2.5" ry="1.8" fill="#2d2d2d" />
        {/* Mouth */}
        {mood === "celebrating" ? (
          <path d="M 20 25 Q 24 28 28 25" fill="none" stroke={style.eyeColor} strokeWidth="1.2" strokeLinecap="round" />
        ) : mood === "error" ? (
          <path d="M 20 26 Q 24 24 28 26" fill="none" stroke={style.eyeColor} strokeWidth="1.2" strokeLinecap="round" />
        ) : (
          <line x1="20" y1="25" x2="28" y2="25" stroke="#555" strokeWidth="1.2" strokeLinecap="round" />
        )}
        {/* Body */}
        <rect x="12" y="28" width="24" height="12" rx="3" fill="#f0f0f0" stroke="#2d2d2d" strokeWidth="1" />
        {/* Belly */}
        <ellipse cx="24" cy="34" rx="8" ry="5" fill="#e8e8e8" />
        {/* Arms reaching toward Enter key */}
        <rect x="6" y="30" width="6" height="5" rx="2" fill="#2d2d2d" />
        <rect x="36" y="30" width="6" height="5" rx="2" fill="#2d2d2d" />
        {/* Big Enter Key - high-blue style */}
        <rect x="8" y="40" width="32" height="7" rx="2" fill="#4a7fff" stroke="#3a6ae0" strokeWidth="0.8" />
        <rect x="9" y="41" width="30" height="1.5" rx="0.5" fill="white" opacity="0.2" />
        <text x="24" y="46.2" textAnchor="middle" fill="white" fontFamily="monospace" fontSize="4.5" fontWeight="bold">
          ENTER ⏎
        </text>
      </svg>
    </div>
  );
}
