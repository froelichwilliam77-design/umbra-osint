import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Surfaces mount/runtime errors as red text on black instead of a blank #root. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Umbra ErrorBoundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: "#0a0a0f",
            color: "#f87171",
            minHeight: "100vh",
            padding: "1.5rem",
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 14,
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Umbra failed to mount</div>
          <div>{this.state.error.message}</div>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: "8px 12px",
              background: "#1a1a24",
              color: "#f87171",
              border: "1px solid #f87171",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
