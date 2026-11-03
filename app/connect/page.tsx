import ConnectGoogle from "@/components/sarah/ConnectGoogle";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Connect");

export default function ConnectPage() {
  return <ConnectGoogle />;
}
