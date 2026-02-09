import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Редірект з /artist/bp/{slug|id} на /artist/{slug|id}. */
export default async function ArtistBpRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) redirect("/leads");
  redirect(`/artist/${id}`);
}
