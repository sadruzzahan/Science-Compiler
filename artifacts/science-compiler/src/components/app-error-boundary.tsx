import { Component, type ErrorInfo, type ReactNode } from "react";
import { Sentry, getLastRequestId } from "@/lib/sentry";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode }
interface State { error: Error | null; eventId: string | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, eventId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const eventId = Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    this.setState({ eventId });
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ error: null, eventId: null });

  render() {
    if (!this.state.error) return this.props.children;
    const requestId = getLastRequestId();
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-sm" data-testid="app-error-boundary">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-semibold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            An unexpected error occurred while rendering this page. The error has been reported.
          </p>
          <pre className="text-xs bg-muted p-2 rounded mb-4 overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <div className="text-xs text-muted-foreground space-y-1 mb-4">
            {this.state.eventId && (
              <div>Event ID: <code className="font-mono">{this.state.eventId}</code></div>
            )}
            {requestId && (
              <div>Last Request ID: <code className="font-mono">{requestId}</code></div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={this.reset} variant="outline" size="sm">Try again</Button>
            <Button onClick={() => window.location.reload()} size="sm">Reload page</Button>
          </div>
        </div>
      </div>
    );
  }
}
