const STORAGE_KEY = "ai-workbench-last-working-dir";

export function usePersistedDir() {
  const getLastDir = (): string => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "~/ai-workspace";
    } catch {
      return "~/ai-workspace";
    }
  };

  const saveDir = (dir: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, dir);
    } catch {
      // localStorage unavailable (private browsing, quota exceeded)
    }
  };

  return { getLastDir, saveDir };
}
