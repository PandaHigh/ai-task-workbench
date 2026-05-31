import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface ReportTabProps {
  content: string;
}

export function ReportTab({ content }: ReportTabProps) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(content, { async: false }) as string), [content]);

  return (
    <div
      className="markdown-body text-sm leading-relaxed"
      style={{ color: "var(--text-primary)", animation: "fadeIn 0.3s ease-out" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
