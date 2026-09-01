import { Component, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// ErrorBoundary, catches render/runtime errors in its subtree and shows a
// recoverable fallback instead of letting the whole app unmount to a blank
// (black) screen. React error boundaries must be class components.
// ---------------------------------------------------------------------------

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Keep a console trail for debugging; the UI still recovers gracefully.
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-medium text-ink dark:text-coal-text">
            {this.props.fallbackLabel ?? 'Something went wrong rendering this view.'}
          </p>
          <p className="max-w-md break-words text-xs text-ink-faint dark:text-coal-soft">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay-soft"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
