import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorId: string | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: undefined,
    errorInfo: undefined,
    errorId: null,
  };

  public static getDerivedStateFromError(_: Error): Partial<State> {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, errorId: new Date().getTime().toString() }; // Simple unique ID for the error instance
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
    // You could also log the error to an error reporting service here
  }

  handleReload = () => {
    window.location.reload();
  }

  handleGoToSearch = () => {
    // Clear the error state before navigating to prevent an immediate re-render of the error UI
    // if the navigation itself doesn't immediately cause a full page reload or remount of the ErrorBoundary.
    // However, for robustness, simply navigating might be enough if the underlying cause is fixed.
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, errorId: null }, () => {
      window.location.hash = '#search';
      // If the app is still in a broken state, a reload after changing hash might be safer
      // setTimeout(() => window.location.reload(), 50);
    });
  }


  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-nikke-bg text-nikke-text-primary p-6">
          <div className="bg-nikke-bg-alt p-8 rounded-lg shadow-2xl max-w-lg w-full text-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 text-red-500 mx-auto mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.248-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z" />
            </svg>
            <h1 className="text-2xl font-bold text-nikke-text-primary mb-3">Oops! Something went wrong.</h1>
            <p className="text-nikke-text-secondary mb-6">
              We're sorry, but the Nikke Forbidden Library encountered an unexpected error. 
              Please try reloading the page or navigating to the search page.
            </p>
            
            <div className="space-y-3">
              <button
                onClick={this.handleReload}
                className="w-full px-4 py-2.5 bg-nikke-accent text-nikke-bg font-semibold rounded-md hover:bg-nikke-accent-dark transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                Reload Page
              </button>
              <button
                onClick={this.handleGoToSearch}
                className="w-full px-4 py-2.5 bg-nikke-border text-nikke-text-primary font-semibold rounded-md hover:bg-slate-600 transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                Go to Search Page
              </button>
            </div>

            {this.state.error && (
              <details className="mt-6 text-left text-xs bg-nikke-bg p-3 rounded overflow-auto max-h-40">
                <summary className="cursor-pointer text-nikke-text-muted hover:text-nikke-text-secondary">Error Details</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all">
                  {this.state.error && this.state.error.toString()}
                  {this.state.errorInfo && `\n\nComponent Stack:\n${this.state.errorInfo.componentStack}`}
                </pre>
              </details>
            )}
             <p className="text-xs text-nikke-text-muted mt-4">Error ID: {this.state.errorId || 'N/A'}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
export default ErrorBoundary;