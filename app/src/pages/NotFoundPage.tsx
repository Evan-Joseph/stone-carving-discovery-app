import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";

export function NotFoundPage() {
  return (
    <AppShell title="页面不存在" subtitle="请返回首页继续探索">
      <div className="panel">
        <p>访问路径无效。</p>
        <div className="hero-actions">
          <Link className="btn primary" to="/">
            返回首页
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
