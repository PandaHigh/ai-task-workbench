import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  expanded: boolean;
  retryKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, expanded: false, retryKey: 0 };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, expanded: false, retryKey: 0 };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState((s) => ({ hasError: false, error: null, expanded: false, retryKey: s.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8" style={{ animation: "fadeIn 0.3s ease-out" }}>
          <div className="max-w-md text-center">
            <div style={{ fontSize: "40px", marginBottom: "16px", opacity: 0.5 }}>⚠</div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px", color: "var(--text-primary)" }}>
              出错了
            </h2>
            <p style={{ fontSize: "13px", marginBottom: "16px", color: "var(--text-secondary)" }}>
              {this.state.error?.message || "未知错误"}
            </p>
            {this.state.error?.stack && (
              <div style={{ marginBottom: "16px" }}>
                <button
                  onClick={() => this.setState((s) => ({ expanded: !s.expanded }))}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--blue)",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  {this.state.expanded ? "收起" : "查看详情"}
                </button>
                {this.state.expanded && (
                  <pre
                    style={{
                      textAlign: "left",
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      background: "var(--bg-primary)",
                      padding: "8px",
                      borderRadius: "6px",
                      maxHeight: "120px",
                      overflow: "auto",
                      marginTop: "8px",
                    }}
                  >
                    {this.state.error.stack}
                  </pre>
                )}
              </div>
            )}
            <button
              onClick={this.handleRetry}
              style={{
                padding: "6px 16px",
                background: "var(--blue)",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return (
      <div key={this.state.retryKey} className="flex-1 flex flex-col min-h-0">
        {this.props.children}
      </div>
    );
  }
}
