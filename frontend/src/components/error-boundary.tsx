import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/logger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Catches render-time errors anywhere below it. Shows a generic fallback — the React
// error / stack is never rendered to the user, only sent to the backend log sink.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error(error.message, {
      stack: error.stack,
      context: { componentStack: info.componentStack },
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Ceva nu a mers bine</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            A apărut o eroare neașteptată. Te rugăm să reîncarci pagina.
          </p>
          <Button onClick={() => window.location.reload()}>Reîncarcă</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
