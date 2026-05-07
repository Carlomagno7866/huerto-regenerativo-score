"use client";

import { ArrowLeftRight, Scale, Search, Sprout } from "lucide-react";
import { useMemo, useState } from "react";
import { SpeciesSearch, type SpeciesOption } from "@/app/components/species-search";
import type { PublicSpecies } from "@/lib/public-species";

export function TruequeClient({ species }: { species: PublicSpecies[] }) {
  const [fromOption, setFromOption] = useState<SpeciesOption | null>(null);
  const [toOption, setToOption] = useState<SpeciesOption | null>(null);
  const [fromSpecies, setFromSpecies] = useState<PublicSpecies | null>(null);
  const [toSpecies, setToSpecies] = useState<PublicSpecies | null>(null);
  const [grams, setGrams] = useState(1000);
  const [loading, setLoading] = useState(false);
  const options = species.map(({ id, commonName, scientificName, family }) => ({ id, commonName, scientificName, family }));

  const result = useMemo(() => {
    if (!fromSpecies || !toSpecies || grams <= 0) return null;
    const fromValue = Math.max(fromSpecies.exchangeValue, 0.01);
    const toValue = Math.max(toSpecies.exchangeValue, 0.01);
    const equivalentGrams = (grams * fromValue) / toValue;
    return {
      equivalentGrams,
      rate: fromValue / toValue,
      scorePoints: grams * fromValue
    };
  }, [fromSpecies, grams, toSpecies]);

  async function calculate() {
    if (!fromOption || !toOption) return;
    setLoading(true);
    setFromSpecies(species.find((item) => item.id === fromOption.id) ?? null);
    setToSpecies(species.find((item) => item.id === toOption.id) ?? null);
    setLoading(false);
  }

  function swap() {
    setFromOption(toOption);
    setToOption(fromOption);
    setFromSpecies(toSpecies);
    setToSpecies(fromSpecies);
  }

  return (
    <main className="page-shell">
      <section className="intro-section">
        <div>
          <p>Trueque por SCORE</p>
          <h1>Intercambia especies usando su valor regenerativo</h1>
        </div>
        <p>
          El sistema convierte gramos entre especies segun su SCORE. Una especie con SCORE alto representa mas valor
          por gramo, porque concentra mejor nutricion, rendimiento, eficiencia y resiliencia.
        </p>
      </section>

      <section className="barter-board">
        <div className="tool-panel barter-side">
          <SpeciesSearch
            label="Entrego"
            showButton={false}
            options={options}
            selected={fromOption}
            onSelect={(option) => {
              setFromOption(option);
              setFromSpecies(null);
            }}
          />
          <label className="field">
            <span>
              <Scale aria-hidden /> Gramos a intercambiar
            </span>
            <input min={1} onChange={(event) => setGrams(Number(event.target.value))} step={50} type="number" value={grams} />
          </label>
        </div>

        <div className="swap-column">
          <button aria-label="Intercambiar especies" className="swap-button" onClick={swap} type="button">
            <ArrowLeftRight aria-hidden />
          </button>
          <button className="primary compact calculate-button" disabled={!fromOption || !toOption || loading} onClick={calculate} type="button">
            <Search aria-hidden />
            {loading ? "Calculando" : "Calcular"}
          </button>
        </div>

        <div className="tool-panel barter-side">
          <SpeciesSearch
            label="Recibo"
            showButton={false}
            options={options}
            selected={toOption}
            onSelect={(option) => {
              setToOption(option);
              setToSpecies(null);
            }}
          />
          <div className="exchange-note">
            <Sprout aria-hidden />
            <span>El resultado mantiene equivalencia por puntos SCORE-gramo.</span>
          </div>
        </div>
      </section>

      {result && fromSpecies && toSpecies ? (
        <section className="exchange-result">
          <article className="score-card exchange-card">
            <div>
              <p>
                {formatGrams(grams)} de {fromSpecies.commonName} equivalen a
              </p>
              <h2>{formatGrams(result.equivalentGrams)}</h2>
              <span>de {toSpecies.commonName}</span>
            </div>
            <strong>{result.rate.toFixed(2)}x</strong>
          </article>

          <div className="info-grid">
            <Metric label={`SCORE ${fromSpecies.commonName}`} value={`${fromSpecies.publicScore}/100`} />
            <Metric label={`SCORE ${toSpecies.commonName}`} value={`${toSpecies.publicScore}/100`} />
            <Metric label="Valor entregado" value={`${Math.round(result.scorePoints)} puntos`} />
            <Metric label="Tasa" value={`1 g = ${result.rate.toFixed(2)} g`} />
          </div>
        </section>
      ) : (
        <div className="empty compact-empty">
          <ArrowLeftRight aria-hidden />
          <p>Selecciona dos especies y una cantidad en gramos para calcular el trueque.</p>
        </div>
      )}
    </main>
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

function formatGrams(value: number) {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value)} g`;
}
