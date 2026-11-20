import React from "react";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full rounded-2xl border border-destructive/20 bg-card p-6 shadow-sm">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {i18n.t("common.errorBoundary.title", "页面发生异常渲染错误")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {i18n.t("common.errorBoundary.description", "组件运行时遇到未预期的错误，已启动安全降级保护以防止应用崩溃。")}
            </p>

            {this.state.error?.message ? (
              <div className="mt-3 overflow-hidden rounded-lg bg-muted/60 p-2.5 text-left font-mono text-[11px] text-muted-foreground break-all">
                {this.state.error.message}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={this.handleReset} className="h-8 gap-1.5 text-xs">
                <RefreshCcw className="size-3.5" />
                {i18n.t("common.errorBoundary.retry", "重试渲染")}
              </Button>
              <Button size="sm" onClick={this.handleReload} className="h-8 gap-1.5 text-xs">
                <Home className="size-3.5" />
                {i18n.t("common.errorBoundary.reload", "刷新页面")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
