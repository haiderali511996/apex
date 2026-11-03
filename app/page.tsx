import { redirect } from "next/navigation";
import SarahDeck from "@/components/sarah/SarahDeck";
import { currentUser, getSubscription } from "@/lib/auth";

export default async function Home() {
  // A new account's trial waits for the card check.
  const user = await currentUser();
  if (user && user.role !== "owner" && getSubscription(user).status === "pending") redirect("/billing");
  return <SarahDeck />;
}
