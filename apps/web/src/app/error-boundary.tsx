import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* The server records remain independent from this view. */
  }
  render() {
    return this.state.failed ? (
      <div className="error-boundary">
        <h1>This view could not be displayed.</h1>
        <p>
          The laboratory's recorded work is kept on the server. Reload the
          interface to reconnect.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Pico
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
