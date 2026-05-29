import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "../common/Toast";
import { ENGINE_HTTP_URL } from "../../lib/platform";

interface SkillMeta {
  name: string;
  description: string;
  type: "builtin" | "custom";
  dirName: string;
  createdAt: string;
  fileCount: number;
}

export function SkillsManager() {
  const { connected, call } = useEngine();
  const toast = useToast();
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const builtinSkills = skills.filter((s) => s.type === "builtin");
  const customSkills = skills.filter((s) => s.type === "custom");

  const loadSkills = useCallback(async () => {
    if (!connected) return;
    try {
      const result = await call("skill.list", {});
      setSkills((result as SkillMeta[]) || []);
    } catch (err) {
      toast.error(`加载 Skills 失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }, [connected, call, toast]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.endsWith(".zip")) {
      toast.error("请上传 .zip 文件");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${ENGINE_HTTP_URL}/api/skills/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "上传失败");
      }

      toast.success(`Skill "${file.name.replace(/\.zip$/i, "")}" 上传成功`);
      await loadSkills();
    } catch (err) {
      toast.error(`上传失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (name: string) => {
    setDeleting(name);
    try {
      await call("skill.delete", { name });
      toast.success(`Skill "${name}" 已删除`);
      setConfirmDelete(null);
      await loadSkills();
    } catch (err) {
      toast.error(`删除失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-3 animate-pulse" style={{ height: 48 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Builtin Skills */}
      <div className="glass-card p-4">
        <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>
          内置 Skills ({builtinSkills.length})
        </h3>
        {builtinSkills.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>暂无内置 skills</p>
        ) : (
          <div className="space-y-2">
            {builtinSkills.map((skill) => (
              <div key={skill.name} className="flex items-start justify-between gap-2 p-2 rounded"
                style={{ background: "var(--bg-tertiary)" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                      {skill.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: "var(--blue)", color: "#fff", opacity: 0.7 }}>
                      内置
                    </span>
                  </div>
                  {skill.description && (
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {skill.description}
                    </p>
                  )}
                </div>
                <span className="text-[10px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {skill.fileCount} 文件
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom Skills */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
            自定义 Skills ({customSkills.length})
          </h3>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !connected}
              className="px-3 py-1 rounded text-[10px] font-semibold disabled:opacity-40"
              style={{ background: "var(--blue)", color: "#fff" }}
            >
              {uploading ? "上传中..." : "上传 .zip"}
            </button>
          </div>
        </div>

        {customSkills.length === 0 ? (
          <div className="text-center py-4"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleUpload(e.dataTransfer.files); }}
            style={{ border: "1px dashed var(--border)", borderRadius: 8 }}>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              暂无自定义 skills
            </p>
            <p className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>
              上传包含 SKILL.md 的 .zip 文件
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {customSkills.map((skill) => (
              <div key={skill.name} className="flex items-start justify-between gap-2 p-2 rounded"
                style={{ background: "var(--bg-tertiary)" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                      {skill.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: "var(--border)", color: "var(--text-secondary)" }}>
                      自定义
                    </span>
                  </div>
                  {skill.description && (
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {skill.description}
                    </p>
                  )}
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {skill.fileCount} 文件 · {new Date(skill.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {confirmDelete === skill.name ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDelete(skill.name)}
                      disabled={deleting === skill.name}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold"
                      style={{ background: "var(--red)", color: "#fff" }}
                    >
                      {deleting === skill.name ? "..." : "确认"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-0.5 rounded text-[10px]"
                      style={{ background: "var(--border)", color: "var(--text-secondary)" }}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(skill.name)}
                    className="text-[10px] shrink-0 opacity-50 hover:opacity-100"
                    style={{ color: "var(--red)" }}
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
