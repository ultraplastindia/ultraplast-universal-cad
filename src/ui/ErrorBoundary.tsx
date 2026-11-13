import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/** If any page fails while drawing, show a clear message instead of a blank screen. Autosaved work is not touched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('Page error:', error, info.componentStack); }
  private onHash = (): void => { if (this.state.error) this.setState({ error: null }); };
  componentDidMount(): void { window.addEventListener('hashchange', this.onHash); }
  componentWillUnmount(): void { window.removeEventListener('hashchange', this.onHash); }
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page" style={{ maxWidth: 640, margin: '60px auto' }}>
        <div className="box err big">
          <h2 style={{ marginTop: 0 }}>Something went wrong on this page</h2>
          <p>Your work is not lost: designs you saved are safe, and unsaved work in the designer is kept by autosave and offered again when you reopen it.</p>
          <p className="muted"><small>{this.state.error.message}</small></p>
          <div className="actions"><button className="primary" onClick={() => window.location.reload()}>Reload the page</button><button onClick={() => { window.location.hash = '#/dashboard'; }}>Go to the dashboard</button></div>
        </div>
      </div>
    );
  }
}
