"use client";

import { useMemo, useState } from "react";
import { Layers3, MapPin, Sprout } from "lucide-react";
import type { Assignment } from "@/lib/types";

type ApiResult = {
  soil: Record<string, number | string | null> | null;
  assignments: Assignment[];
  summary: {
    averageScore: number;
    familyDiversity: number;
    estimatedWaterMm: number;
  };
};

export default function Home() {
  const [years, setYears] = useState(4);
  const [subplots, setSubplots] = useState(4);
  const [areaM2, setAreaM2] = useState(6);
  const [latitude, setLatitude] = useState(-33.45);
  const [longitude, setLongitude] = useState(-70.66);
  const [gardenType, setGardenType] = useState<"optimized-bed" | "natural-soil">("natural-soil");
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
        previousFamilies: []
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

          <div className="grid-controls">
            <NumberControl label="Anios" value={years} min={1} max={8} onChange={setYears} />
            <NumberControl label="Subparcelas" value={subplots} min={1} max={12} onChange={setSubplots} />
            <NumberControl label="m2/subparcela" value={areaM2} min={1} max={80} onChange={setAreaM2} />
          </div>

          <button className="primary" onClick={runOptimization} disabled={loading} type="button">
            {loading ? "Calculando..." : "Generar calendario"}
          </button>
        </div>

        <div className="results">
          <div className="hero-band">
            <div>
              <p>Base local SQLite + USDA + Best4Soil + SoilGrids Chile</p>
              <h2>Calendario automatico por rotacion familiar y SCORE nutricional</h2>
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
              {grouped.map(([year, items]) => (
                <section className="year" key={year}>
                  <h3>Ano {year}</h3>
                  <div className="crop-grid">
                    {items.map((item) => (
                      <article className="crop-card" key={`${item.year}-${item.subplot}`}>
                        <div className="crop-top">
                          <span>Subparcela {item.subplot}</span>
                          <strong>{Math.round(item.score.total * 100)}</strong>
                        </div>
                        <h4>{item.crop.commonName}</h4>
                        <p className="technical-name">
                          {item.crop.family} · {item.crop.scientificName}
                        </p>
                        <dl>
                          <div>
                            <dt>Familia</dt>
                            <dd>{item.crop.family}</dd>
                          </div>
                          <div>
                            <dt>Cosecha</dt>
                            <dd>{item.harvestWindow}</dd>
                          </div>
                          <div>
                            <dt>Nutricion</dt>
                            <dd>{Math.round(item.score.nutrition * 100)}</dd>
                          </div>
                          <div>
                            <dt>Recursos</dt>
                            <dd>{Math.round(item.score.resources * 100)}</dd>
                          </div>
                          <div>
                            <dt>Rotacion</dt>
                            <dd>{Math.round(item.score.resilience * 100)}</dd>
                          </div>
                        </dl>
                        <p className="reason">{item.score.explanation[0]}</p>
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
