import { getPublicSpeciesProfiles } from "@/lib/public-species-profiles";
import { TruequeClient } from "./trueque-client";

export default function TruequePage() {
  return <TruequeClient species={getPublicSpeciesProfiles()} />;
}
