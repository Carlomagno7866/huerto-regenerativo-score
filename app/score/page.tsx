import { ScoreClient } from "./score-client";
import { getPublicSpeciesProfiles } from "@/lib/public-species-profiles";

export default function ScorePage() {
  return <ScoreClient species={getPublicSpeciesProfiles()} />;
}
