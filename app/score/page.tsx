import { ScoreClient } from "./score-client";
import { getSpeciesOptions } from "@/lib/species-options";

export default function ScorePage() {
  return <ScoreClient options={getSpeciesOptions()} />;
}
