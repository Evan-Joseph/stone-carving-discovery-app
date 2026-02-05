import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";

interface AppShellProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  mainClassName?: string;
  hideNav?: boolean;
}

export function AppShell({ title, subtitle, children, mainClassName, hideNav = false }: AppShellProps) {
  return (
    <div className={hideNav ? "app-shell no-nav" : "app-shell"}>
      <header className="app-header">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <main className={mainClassName ? `app-main ${mainClassName}` : "app-main"}>{children}</main>
      {hideNav ? null : (
        <Link className="hall-entry-landscape" to="/hall">
          进入展厅模式
        </Link>
      )}
      {hideNav ? null : <BottomNav />}
    </div>
  );
}
