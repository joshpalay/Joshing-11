import { LoadingPreview } from "./LoadingPreview";

export const dynamic = "force-dynamic";

export default async function LoadingPreviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ card?: string }>;
}) {
  const params = (await searchParams) ?? {};
  return <LoadingPreview initialKey={params.card} />;
}
