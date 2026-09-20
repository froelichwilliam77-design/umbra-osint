import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Umbra failed to mount", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);
    return (
      <div
        style={{
          minHeight: "100vh",
          margin: 0,
          padding: "2rem 1.25rem",
          background: "#07080c",
          color: "#e8e6e1",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ color: "#8b7cf7", letterSpacing: "0.28em", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          UMBRA
        </p>
        <h1 style={{ color: "#ffffff", fontSize: 28, fontWeight: 600, margin: "12px 0" }}>Could not load the ledger</h1>
        <p style={{ color: "#e8e6e1", lineHeight: 1.5 }}>
          The UI crashed while mounting. Reload. If this is a phone PWA after a deploy, the old service worker is being
          replaced — wait a second and retry.
        </p>
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: "#12151d",
            color: "#f07178",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 20,
            background: "#8b7cf7",
            color: "#ffffff",
            border: 0,
            borderRadius: 8,
            padding: "12px 18px",
            fontSize: 16,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
