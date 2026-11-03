import { redirect } from "next/navigation";
import SiteShell from "@/components/site/SiteShell";
import WritePost from "@/components/site/WritePost";
import { currentUser } from "@/lib/auth";
import { BRAND } from "@/lib/persona";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Write a post");
export const dynamic = "force-dynamic";

/** Only signed-in users can write; anyone else is sent to log in and brought back. */
export default async function NewPost() {
  if (!(await currentUser())) redirect("/login?next=/community/new");
  return <SiteShell><div className="site-wrap"><WritePost /></div></SiteShell>;
}
