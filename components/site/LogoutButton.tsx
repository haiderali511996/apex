"use client";

export default function LogoutButton({ className }: { className?: string }) {
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/welcome";
  };
  return <button type="button" className={className} onClick={logout} style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0 }}>Log out</button>;
}
