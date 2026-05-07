import { ScoreClient } from "./score-client";
import { getPublicSpeciesProfiles } from "@/lib/public-species-profiles";

export default async function ScorePage({ searchParams }: { searchParams?: Promise<{ species?: string }> }) {
  const params = await searchParams;
  return <ScoreClient initialSpeciesId={params?.species ?? null} species={getPublicSpeciesProfiles()} />;
}
