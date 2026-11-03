import SiteShell from "@/components/site/SiteShell";
import AuthForm from "@/components/site/AuthForm";
import { BRAND } from "@/lib/persona";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Log in");

export default function Login() {
  return <SiteShell><div className="site-wrap"><AuthForm mode="login" /></div></SiteShell>;
}
