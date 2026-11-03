import AgentChat from "@/components/AgentChat";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Assistant");

export default function AgentPage() {
  return <AgentChat />;
}
