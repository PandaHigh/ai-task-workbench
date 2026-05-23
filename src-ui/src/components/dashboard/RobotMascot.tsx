import type { RobotMood } from "@ai-workbench/shared";

interface RobotMascotProps {
  mood: RobotMood;
  size?: number;
}

export function RobotMascot({ mood, size = 48 }: RobotMascotProps) {
  const moodStyles: Record<RobotMood, { anim: string; eyeColor: string; glow: string }> = {
    idle: { anim: "animate-float", eyeColor: "var(--blue)", glow: "none" },
    thinking: { anim: "animate-pulse-slow", eyeColor: "var(--yellow)", glow: "none" },
    working: { anim: "animate-spin-slow", eyeColor: "var(--green)", glow: "0 0 20px var(--green)" },
    celebrating: { anim: "animate-float", eyeColor: "var(--green)", glow: "0 0 30px var(--green)" },
    error: { anim: "", eyeColor: "var(--red)", glow: "0 0 20px var(--red)" },
  };

  const style = moodStyles[mood];

  return (
    <div
      className={`inline-flex items-center justify-center ${style.anim}`}
      style={{
        width: size,
        height: size,
        filter: style.glow !== "none" ? `drop-shadow(${style.glow})` : undefined,
      }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size}>
        {/* Body */}
        <rect
          x="12" y="18" width="24" height="20" rx="4"
          fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="1.5"
        />
        {/* Head */}
        <rect
          x="14" y="8" width="20" height="16" rx="6"
          fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5"
        />
        {/* Antenna */}
        <line
          x1="24" y1="8" x2="24" y2="3"
          stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"
        />
        <circle
          cx="24" cy="3" r="2"
          fill={style.eyeColor}
        />
        {/* Eyes */}
        <circle cx="19" cy="15" r="2.5" fill={style.eyeColor}>
          {mood === "thinking" && (
            <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
          )}
        </circle>
        <circle cx="29" cy="15" r="2.5" fill={style.eyeColor}>
          {mood === "thinking" && (
            <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" begin="0.5s" />
          )}
        </circle>
        {/* Mouth */}
        {mood === "celebrating" ? (
          <path d="M 20 21 Q 24 25 28 21" fill="none" stroke={style.eyeColor} strokeWidth="1.5" strokeLinecap="round" />
        ) : mood === "error" ? (
          <path d="M 20 22 Q 24 19 28 22" fill="none" stroke={style.eyeColor} strokeWidth="1.5" strokeLinecap="round" />
        ) : (
          <line x1="20" y1="21" x2="28" y2="21" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" />
        )}
        {/* Arms */}
        <rect x="8" y="22" width="4" height="10" rx="2" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="1" />
        <rect x="36" y="22" width="4" height="10" rx="2" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="1" />
        {/* Legs */}
        <rect x="16" y="38" width="5" height="6" rx="2" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="1" />
        <rect x="27" y="38" width="5" height="6" rx="2" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="1" />
      </svg>
    </div>
  );
}
