"use client";

import { useMemo, useState } from "react";
import { BarChart3, Droplets, Leaf, MapPin, RotateCcw, Search, Sprout } from "lucide-react";
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

const nutrients = [
  ["fiber", "Fibra"],
  ["iron", "Hierro"],
  ["vitaminC", "Vit. C"],
  ["vitaminA", "Vit. A"],
  ["folate", "Folato"],
  ["protein", "Proteina"]
] as const;

export default function Home() {
  const [years, setYears] = useState(4);
  const [subplots, setSubplots] = useState(4);
  const [areaM2, setAreaM2] = useState(6);
  const [latitude, setLatitude] = useState(-33.45);
  const [longitude, setLongitude] = useState(-70.66);
  const [search, setSearch] = useState("");
  const [focusNutrients, setFocusNutrients] = useState<string[]>(["fiber", "iron", "vitaminC"]);
  const [priorities, setPriorities] = useState({ nutrition: 45, resources: 25, resilience: 30 });
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
        search,
        focusNutrients,
        previousFamilies: [],
        priorities
      })
    });
    setResult(await response.json());
    setLoading(false);
  }

  function toggleNutrient(value: string) {
    setFocusNutrients((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
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

          <label className="field">
            <span>
              <Search aria-hidden /> Filtro de cultivos
            </span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="tomato, brassica, fabaceae" />
          </label>

          <div className="grid-controls">
            <NumberControl label="Anios" value={years} min={1} max={8} onChange={setYears} />
            <NumberControl label="Subparcelas" value={subplots} min={1} max={12} onChange={setSubplots} />
            <NumberControl label="m2/subparcela" value={areaM2} min={1} max={80} onChange={setAreaM2} />
          </div>

          <div className="field">
            <span>
              <Leaf aria-hidden /> Nutrientes foco
            </span>
            <div className="chips">
              {nutrients.map(([value, label]) => (
                <button
                  key={value}
                  className={focusNutrients.includes(value) ? "chip active" : "chip"}
                  onClick={() => toggleNutrient(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Slider label="Nutricion" icon={<BarChart3 aria-hidden />} value={priorities.nutrition} onChange={(nutrition) => setPriorities({ ...priorities, nutrition })} />
          <Slider label="Recursos" icon={<Droplets aria-hidden />} value={priorities.resources} onChange={(resources) => setPriorities({ ...priorities, resources })} />
          <Slider label="Resiliencia" icon={<RotateCcw aria-hidden />} value={priorities.resilience} onChange={(resilience) => setPriorities({ ...priorities, resilience })} />

          <button className="primary" onClick={runOptimization} disabled={loading} type="button">
            {loading ? "Calculando..." : "Optimizar seleccion"}
          </button>
        </div>

        <div className="results">
          <div className="hero-band">
            <div>
              <p>Base local SQLite + USDA + Best4Soil + SoilGrids Chile</p>
              <h2>Eleccion de cultivos por SCORE, rotacion y suelo</h2>
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
                        <p>{item.crop.scientificName}</p>
                        <div className="bars">
                          <Bar label="Nut." value={item.score.nutrition} />
                          <Bar label="Rec." value={item.score.resources} />
                          <Bar label="Rot." value={item.score.resilience} />
                        </div>
                        <dl>
                          <div>
                            <dt>Familia</dt>
                            <dd>{item.crop.family}</dd>
                          </div>
                          <div>
                            <dt>Cosecha</dt>
                            <dd>{item.harvestWindow}</dd>
                          </div>
                        </dl>
                        <p className="reason">{item.score.explanation[2]}</p>
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

function Slider(props: { label: string; icon: React.ReactNode; value: number; onChange: (value: number) => void }) {
  return (
    <label className="slider">
      <span>
        {props.icon} {props.label}
      </span>
      <input type="range" min={0} max={100} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
      <b>{props.value}</b>
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

function Bar(props: { label: string; value: number }) {
  return (
    <div className="bar">
      <span>{props.label}</span>
      <i style={{ width: `${Math.round(props.value * 100)}%` }} />
    </div>
  );
}
