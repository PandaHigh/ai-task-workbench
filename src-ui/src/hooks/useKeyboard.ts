import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export interface ShortcutDef {
  key: string;
  mod?: boolean;
  description: string;
  action: () => void;
  priority?: number;
}

const registry: ShortcutDef[] = [];
let modalActive = false;
let toggleHelp: (() => void) | null = null;

export function setModalActive(active: boolean) {
  modalActive = active;
}

export function setToggleHelp(fn: (() => void) | null) {
  toggleHelp = fn;
}

export function getShortcuts(): ShortcutDef[] {
  return [...registry];
}

export function useRegisterShortcut(def: ShortcutDef) {
  useEffect(() => {
    registry.push(def);
    return () => {
      const idx = registry.indexOf(def);
      if (idx >= 0) registry.splice(idx, 1);
    };
  }, [def.key, def.mod, def.action]);
}

export function useKeyboard() {
  const navigate = useNavigate();

  useEffect(() => {
    const defaults: ShortcutDef[] = [
      {
        key: "n",
        mod: true,
        description: "新建任务",
        action: () => navigate("/wizard"),
        priority: 0,
      },
      {
        key: "/",
        mod: true,
        description: "快捷键帮助",
        action: () => toggleHelp?.(),
        priority: 0,
      },
      {
        key: "Escape",
        description: "返回 / 取消",
        action: () => {
          if (!modalActive) {
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag !== "INPUT" && tag !== "TEXTAREA" && !document.activeElement?.getAttribute("contenteditable")) {
              navigate(-1);
            }
          }
        },
        priority: -1,
      },
    ];

    registry.push(...defaults);
    return () => {
      for (const d of defaults) {
        const idx = registry.indexOf(d);
        if (idx >= 0) registry.splice(idx, 1);
      }
    };
  }, [navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modalActive && e.key !== "Escape") return;

      const mod = e.metaKey || e.ctrlKey;

      let matched = false;
      for (const s of registry) {
        if (s.key !== e.key) continue;
        if (s.mod && !mod) continue;
        if (!s.mod && mod) continue;

        if (s.key === "Escape") {
          const tag = (e.target as HTMLElement)?.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA") continue;
        }

        e.preventDefault();
        s.action();
        matched = true;
        break;
      }

      if (!matched && e.key === "Escape" && modalActive) {
        e.preventDefault();
        for (const s of registry) {
          if (s.key === "Escape" && s.priority === 100) {
            s.action();
            break;
          }
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
