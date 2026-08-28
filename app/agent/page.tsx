import AgentChat from "@/components/AgentChat";

export const metadata = { title: "Apex — Talk to your agent" };

export default function AgentPage() {
  return (
    <main style={{ background: "#04080f", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "20px 20px 0", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.2em", color: "rgba(240,237,232,0.5)", textTransform: "uppercase" }}>
        Apex — marketing &amp; SEO assistant
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "0 16px 16px" }}>
        <AgentChat />
      </div>
    </main>
  );
}
