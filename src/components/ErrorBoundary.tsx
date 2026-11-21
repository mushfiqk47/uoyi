import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Changing this key clears a caught error, e.g. when the user switches screens. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/** Keeps a render failure inside one region instead of unmounting the whole application. The
 *  Viewer stays alive for recordings, so its boundary is separate from the lazy screens. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[screen]", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="empty card-empty" role="alert">
          <div className="badge">
            <AlertTriangle className="ic" />
          </div>
          <h2>This screen hit an error</h2>
          <p>{this.state.error.message || "Something unexpected happened while drawing this screen."}</p>
          <button className="btn accent" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
