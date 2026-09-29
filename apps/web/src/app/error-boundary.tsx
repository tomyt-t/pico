import { Component, type ErrorInfo, type ReactNode } from "react";
import { i18n } from "@/web/components/i18n";

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
        <h1>{i18n.t("app.errorTitle")}</h1>
        <p>{i18n.t("app.errorBody")}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {i18n.t("app.reload")}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
