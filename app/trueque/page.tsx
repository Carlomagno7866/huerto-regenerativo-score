import { getSpeciesOptions } from "@/lib/species-options";
import { TruequeClient } from "./trueque-client";

export default function TruequePage() {
  return <TruequeClient options={getSpeciesOptions()} />;
}
