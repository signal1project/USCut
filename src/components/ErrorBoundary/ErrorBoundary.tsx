import React from 'react';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Class-based React ErrorBoundary — the only way to catch errors thrown
 * during React's render/reconciliation cycle (componentDidCatch).
 * Hook-based approaches miss render errors entirely.
 */
class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render error:', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 24,
          padding: 32,
          background: '#1a0a0a',
          color: '#fff',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, color: '#f87171', marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p className="text-sm text-ink-muted">
            An unexpected error occurred in the renderer.
          </p>
        </div>
        <pre
          style={{
            maxWidth: 600,
            width: '100%',
            fontSize: 11,
            background: '#2a1010',
            border: '1px solid #5a2020',
            borderRadius: 6,
            padding: 16,
            overflow: 'auto',
            color: '#fca5a5',
            whiteSpace: 'pre-wrap',
          }}
        >
          {this.state.error?.stack ?? String(this.state.error)}
        </pre>
        <button
          style={{
            padding: '6px 16px',
            background: '#3a1010',
            color: '#fca5a5',
            border: '1px solid #5a2020',
            borderRadius: 6,
            cursor: 'pointer',
          }}
          onClick={this.reset}
        >
          Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
