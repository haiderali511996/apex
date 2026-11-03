import SiteShell from "@/components/site/SiteShell";
import AuthForm from "@/components/site/AuthForm";
import { BRAND } from "@/lib/persona";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Start your free trial", "Create your UNC AI Assistant account: choose its name, face and voice, and try it free for 7 days.", "/signup");

export default function Signup() {
  return <SiteShell><div className="site-wrap"><AuthForm mode="signup" /></div></SiteShell>;
}
