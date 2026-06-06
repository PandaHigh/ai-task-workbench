import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6" style={{ minHeight: 120 }}>
          <p className="text-xs font-bold mb-2" style={{ color: "var(--red)" }}>
            {this.props.name ? `${this.props.name} 加载出错` : "加载出错"}
          </p>
          <p className="text-[10px] mb-3 text-center max-w-xs" style={{ color: "var(--text-secondary)" }}>
            {this.state.error?.message || "未知错误"}
          </p>
          <button
            onClick={this.handleRetry}
            className="text-xs px-3 py-1.5 rounded font-semibold"
            style={{ background: "var(--blue)", color: "#fff" }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
