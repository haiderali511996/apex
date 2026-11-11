"use client";

export default function DeletePost({ id }: { id: string }) {
  const remove = async () => {
    if (!confirm("Delete this post? This can't be undone.")) return;
    const res = await fetch(`/api/community?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/community";
    else alert((await res.json().catch(() => ({}))).error || "Couldn't delete the post.");
  };
  return <button type="button" className="btn btn-ghost btn-small" onClick={remove}>Delete post</button>;
}
