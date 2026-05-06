"use client";

import { useMemo, useState } from "react";
import { Droplets, Layers3, MapPin, Microscope, ShieldCheck, Sprout, Target, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import type { Assignment, NutrientPriority, ScoreObjective, UserMode } from "@/lib/types";

type ApiResult = {
  soil: Record<string, number | string | null> | null;
  assignments: Assignment[];
  summary: {
    averageScore: number;
    familyDiversity: number;
    estimatedWaterMm: number;
    topConfidenceGaps: string[];
    recommendations: Array<{
      crop: string;
      score: number;
      confidence: number;
      reason: string;
      evidence: string;
    }>;
  };
};

const OBJECTIVES: Array<{ value: ScoreObjective; label: string }> = [
  { value: "balanced", label: "Balance" },
  { value: "max-nutrients", label: "Nutrientes" },
  { value: "low-water", label: "Bajo riego" },
  { value: "healthy-rotation", label: "Rotacion" },
  { value: "family-savings", label: "Ahorro" }
];

const NUTRIENTS: Array<{ value: NutrientPriority; label: string }> = [
  { value: "protein", label: "Proteina" },
  { value: "iron", label: "Hierro" },
  { value: "vitaminC", label: "Vit. C" },
  { value: "folate", label: "Folato" },
  { value: "fiber", label: "Fibra" },
  { value: "energy", label: "Energia" }
];

export default function Home() {
  const [years, setYears] = useState(4);
  const [subplots, setSubplots] = useState(4);
  const [areaM2, setAreaM2] = useState(6);
  const [latitude, setLatitude] = useState(-33.45);
  const [longitude, setLongitude] = useState(-70.66);
  const [gardenType, setGardenType] = useState<"optimized-bed" | "natural-soil">("natural-soil");
  const [objective, setObjective] = useState<ScoreObjective>("balanced");
  const [mode, setMode] = useState<UserMode>("home-garden");
  const [priorityNutrients, setPriorityNutrients] = useState<NutrientPriority[]>(["protein", "iron", "vitaminC"]);
  const [excludedCropText, setExcludedCropText] = useState("");
  const [previousFamilyText, setPreviousFamilyText] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<number, Assignment[]>();
    for (const item of result?.assignments ?? []) {
      map.set(item.year, [...(map.get(item.year) ?? []), item]);
    }
    return Array.from(map.entries());
  }, [result]);

  async function runOptimization() {
    setLoading(true);
    const response = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        years,
        subplots,
        areaM2,
        latitude,
        longitude,
        gardenType,
        objective,
        mode,
        priorityNutrients,
        previousFamilies: parseList(previousFamilyText),
        excludedCropNames: parseList(excludedCropText),
        excludedCropIds: []
      })
    });
    setResult(await response.json());
    setLoading(false);
  }

  return (
    <main>
      <section className="workspace">
        <div className="panel controls">
          <div className="brand">
            <Sprout aria-hidden />
            <div>
              <p>SCORE regenerativo</p>
              <h1>Planificador agricola</h1>
            </div>
          </div>

          <label className="field">
            <span>
              <MapPin aria-hidden /> Coordenadas
            </span>
            <div className="split">
              <input value={latitude} onChange={(event) => setLatitude(Number(event.target.value))} type="number" step="0.01" />
              <input value={longitude} onChange={(event) => setLongitude(Number(event.target.value))} type="number" step="0.01" />
            </div>
          </label>

          <div className="field">
            <span>
              <Layers3 aria-hidden /> Tipo de huerta
            </span>
            <div className="segmented" role="group" aria-label="Tipo de huerta">
              <button
                className={gardenType === "natural-soil" ? "active" : ""}
                onClick={() => setGardenType("natural-soil")}
                type="button"
              >
                Suelo natural
              </button>
              <button
                className={gardenType === "optimized-bed" ? "active" : ""}
                onClick={() => setGardenType("optimized-bed")}
                type="button"
              >
                Bancal optimizado
              </button>
            </div>
          </div>

          <div className="field">
            <span>
              <Target aria-hidden /> Objetivo
            </span>
            <div className="segmented objective-grid" role="group" aria-label="Objetivo de ranking">
              {OBJECTIVES.map((item) => (
                <button
                  className={objective === item.value ? "active" : ""}
                  key={item.value}
                  onClick={() => setObjective(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>
              <WalletCards aria-hidden /> Modo
            </span>
            <div className="segmented" role="group" aria-label="Modo de uso">
              <button className={mode === "home-garden" ? "active" : ""} onClick={() => setMode("home-garden")} type="button">
                Huerto familiar
              </button>
              <button className={mode === "small-farmer" ? "active" : ""} onClick={() => setMode("small-farmer")} type="button">
                Agricultor
              </button>
            </div>
          </div>

          <div className="grid-controls">
            <NumberControl label="Anos" value={years} min={1} max={8} onChange={setYears} />
            <NumberControl label="Subparcelas" value={subplots} min={1} max={12} onChange={setSubplots} />
            <NumberControl label="m2/subparcela" value={areaM2} min={1} max={80} onChange={setAreaM2} />
          </div>

          <div className="field">
            <span>Nutrientes prioritarios</span>
            <div className="chips" role="group" aria-label="Nutrientes prioritarios">
              {NUTRIENTS.map((item) => (
                <button
                  className={priorityNutrients.includes(item.value) ? "active" : ""}
                  key={item.value}
                  onClick={() => toggleNutrient(item.value, priorityNutrients, setPriorityNutrients)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Cultivos bloqueados</span>
            <input
              value={excludedCropText}
              onChange={(event) => setExcludedCropText(event.target.value)}
              placeholder="Ej: tomate, papa"
              type="text"
            />
          </label>

          <label className="field">
            <span>Familias ya usadas</span>
            <input
              value={previousFamilyText}
              onChange={(event) => setPreviousFamilyText(event.target.value)}
              placeholder="Ej: Solanaceae, Brassicaceae"
              type="text"
            />
          </label>

          <button className="primary" onClick={runOptimization} disabled={loading} type="button">
            {loading ? "Calculando..." : "Generar calendario"}
          </button>
        </div>

        <div className="results">
          <div className="hero-band">
            <div>
              <p>Base local SQLite + USDA + FAOSTAT + Best4Soil + SoilGrids Chile</p>
              <h2>SCORE v2 por nutrientes utiles, agua, suelo y sanidad</h2>
            </div>
            {result ? (
              <div className="meters">
                <Metric label="SCORE" value={`${Math.round(result.summary.averageScore * 100)}`} />
                <Metric label="Familias" value={`${result.summary.familyDiversity}`} />
                <Metric label="Agua mm" value={`${Math.round(result.summary.estimatedWaterMm)}`} />
              </div>
            ) : null}
          </div>

          {!result ? (
            <div className="empty">
              <Sprout aria-hidden />
              <p>Configura el huerto y ejecuta el optimizador.</p>
            </div>
          ) : (
            <div className="timeline">
              {result.summary.topConfidenceGaps.length ? (
                <div className="confidence-strip">
                  {result.summary.topConfidenceGaps.map((gap) => (
                    <span key={gap}>{gap}</span>
                  ))}
                </div>
              ) : null}
              {grouped.map(([year, items]) => (
                <section className="year" key={year}>
                  <h3>Ano {year}</h3>
                  <div className="crop-grid">
                    {items.map((item) => (
                      <article className="crop-card" key={`${item.year}-${item.subplot}`} style={{ borderTopColor: familyColor(item.crop.family) }}>
                        <div className="crop-top">
                          <span>Subparcela {item.subplot}</span>
                          <strong>{Math.round(item.score.total * 100)}</strong>
                        </div>
                        <h4>{item.crop.commonName}</h4>
                        <p className="technical-name">
                          {item.crop.family} - {item.crop.scientificName}
                        </p>

                        <div className="score-bars" aria-label="Desglose SCORE v2">
                          <ScoreBar label="Nut." value={item.score.nutrition} />
                          <ScoreBar label="Agua" value={item.score.resources} />
                          <ScoreBar label="San." value={item.score.rotation} />
                          <ScoreBar label="Suelo" value={item.score.soil} />
                        </div>

                        <dl>
                          <div>
                            <dt>Rendimiento</dt>
                            <dd>{item.crop.yieldKgM2.toFixed(2)} kg/m2</dd>
                          </div>
                          <div>
                            <dt>Cosecha</dt>
                            <dd>{item.harvestWindow}</dd>
                          </div>
                          <div>
                            <dt>Agua/ciclo</dt>
                            <dd>{Math.round(item.crop.waterMmCycle)} mm</dd>
                          </div>
                          <div>
                            <dt>Confianza</dt>
                            <dd>{Math.round(item.score.confidence * 100)}</dd>
                          </div>
                          <div>
                            <dt>m2-dia</dt>
                            <dd>{item.score.diagnostics.nutrientsPerM2Day.toFixed(2)}</dd>
                          </div>
                          <div>
                            <dt>USDA match</dt>
                            <dd>{item.crop.matchedFood ?? "Sin match"}</dd>
                          </div>
                        </dl>

                        <div className="explanation">
                          <p className="reason">{item.score.explanation[0]}</p>
                          <ul>
                            {item.score.explanation.slice(1).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="evidence">
                          <EvidencePill icon={<Microscope aria-hidden />} label={item.crop.evidence.yieldKgM2.label} />
                          <EvidencePill icon={<Droplets aria-hidden />} label={item.crop.evidence.waterMmCycle.label} />
                          <EvidencePill icon={<ShieldCheck aria-hidden />} label={item.score.confidenceDetail.rotation.label} />
                        </div>

                        <div className="confidence-grid">
                          {Object.entries(item.score.confidenceDetail).map(([domain, detail]) => (
                            <span key={domain}>
                              <b>{domain}</b>
                              {detail.level}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleNutrient(
  value: NutrientPriority,
  selected: NutrientPriority[],
  setSelected: (value: NutrientPriority[]) => void
) {
  setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
}

function familyColor(family: string) {
  const palette = ["#2f7d58", "#2f76a6", "#d7a028", "#a6553d", "#7457a6", "#51753a", "#b44b6b"];
  const index = Array.from(family).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return palette[index];
}

function ScoreBar(props: { label: string; value: number }) {
  return (
    <div className="score-bar">
      <span>{props.label}</span>
      <div>
        <i style={{ width: `${Math.round(props.value * 100)}%` }} />
      </div>
    </div>
  );
}

function EvidencePill(props: { icon: ReactNode; label: string }) {
  return (
    <span className="evidence-pill">
      {props.icon}
      {props.label}
    </span>
  );
}

function NumberControl(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="number-control">
      <span>{props.label}</span>
      <input type="number" min={props.min} max={props.max} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
