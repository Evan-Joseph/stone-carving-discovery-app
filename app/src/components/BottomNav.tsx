import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "首页", icon: "◉" },
  { to: "/excavate", label: "发掘", icon: "⛏" },
  { to: "/collection", label: "文物库", icon: "▦" },
  { to: "/ai-guide", label: "AI导游", icon: "✦" }
];

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
        >
          <span aria-hidden>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
