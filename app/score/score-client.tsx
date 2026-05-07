"use client";

import { Droplets, Leaf, Microscope, ShieldCheck, Sprout, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { SpeciesSearch, type SpeciesOption } from "@/app/components/species-search";
import type { PublicSpecies } from "@/lib/public-species";

export function ScoreClient({ species: allSpecies }: { species: PublicSpecies[] }) {
  const [selected, setSelected] = useState<SpeciesOption | null>(null);
  const [species, setSpecies] = useState<PublicSpecies | null>(null);
  const [loading, setLoading] = useState(false);
  const options = allSpecies.map(({ id, commonName, scientificName, family }) => ({ id, commonName, scientificName, family }));

  async function loadSpecies(target = selected) {
    if (!target) return;
    setLoading(true);
    setSpecies(allSpecies.find((item) => item.id === target.id) ?? null);
    setLoading(false);
  }

  return (
    <main className="page-shell">
      <section className="intro-section">
        <div>
          <p>SCORE regenerativo</p>
          <h1>Una lectura simple del valor agricola de cada especie</h1>
        </div>
        <p>
          El SCORE resume en una escala de 0 a 100 que tan conveniente es una especie para un huerto regenerativo,
          combinando nutrientes, uso de agua, rendimiento, rotacion sanitaria, suelo y confianza de datos.
        </p>
      </section>

      <section className="tool-panel">
        <SpeciesSearch
          label="Buscar especie"
          options={options}
          selected={selected}
          onSelect={(option) => {
            setSelected(option);
            setSpecies(null);
          }}
          onSearch={() => loadSpecies()}
        />
      </section>

      {loading ? <div className="empty compact-empty">Buscando en la base local...</div> : null}

      {species ? (
        <section className="species-detail">
          <article className="score-card">
            <div>
              <p>{species.family}</p>
              <h2>{species.commonName}</h2>
              <span>{species.scientificName}</span>
            </div>
            <strong>{species.publicScore}</strong>
          </article>

          <div className="info-grid">
            <Metric icon={<Leaf aria-hidden />} label="Rendimiento estimado" value={`${species.yieldKgM2.toFixed(2)} kg/m2`} />
            <Metric icon={<Timer aria-hidden />} label="Ciclo de cultivo" value={`${species.cycleDays} dias`} />
            <Metric icon={<Droplets aria-hidden />} label="Agua por ciclo" value={`${Math.round(species.waterMmCycle)} mm`} />
            <Metric icon={<ShieldCheck aria-hidden />} label="Confianza SCORE" value={`${Math.round(species.score.confidence * 100)}/100`} />
          </div>

          <section className="tool-panel detail-panel">
            <h3>Lectura para publico general</h3>
            <div className="score-bars public-bars">
              <ScoreBar label="Nutrientes" value={species.score.nutrition} />
              <ScoreBar label="Agua y espacio" value={species.score.resources} />
              <ScoreBar label="Rotacion sana" value={species.score.rotation} />
              <ScoreBar label="Suelo" value={species.score.soil} />
            </div>
            <ul className="plain-list">
              {species.summary.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="detail-columns">
            <article className="tool-panel">
              <h3>Nutrientes destacados</h3>
              {species.nutrition.length ? (
                <dl className="public-list">
                  {species.nutrition.slice(0, 8).map((item) => (
                    <div key={item.key}>
                      <dt>{item.label}</dt>
                      <dd>{formatNumber(item.value)} / 100 g</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted">No hay match nutricional suficiente en USDA para esta especie.</p>
              )}
            </article>

            <article className="tool-panel">
              <h3>Datos y sanidad</h3>
              <div className="evidence">
                <span className="evidence-pill">
                  <Microscope aria-hidden />
                  {species.evidence.yieldKgM2.label}
                </span>
                <span className="evidence-pill">
                  <Droplets aria-hidden />
                  {species.evidence.waterMmCycle.label}
                </span>
              </div>
              <ul className="plain-list small">
                {species.riskAgents.length ? (
                  species.riskAgents.slice(0, 4).map((agent) => (
                    <li key={`${agent.type}-${agent.name}`}>
                      {agent.name}: {agent.hostStatus}
                    </li>
                  ))
                ) : (
                  <li>Sin agentes sanitarios especificos registrados para mostrar.</li>
                )}
              </ul>
            </article>
          </section>
        </section>
      ) : (
        <div className="empty compact-empty">
          <Sprout aria-hidden />
          <p>Escribe una especie, elige una opcion y presiona Buscar.</p>
        </div>
      )}
    </main>
  );
}

function Metric(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric info-metric">
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value);
}
