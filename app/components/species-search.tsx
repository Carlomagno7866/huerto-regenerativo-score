"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SpeciesOption = {
  id: string;
  commonName: string;
  scientificName: string;
  family: string;
};

type Props = {
  label: string;
  buttonLabel?: string;
  showButton?: boolean;
  options: SpeciesOption[];
  selected: SpeciesOption | null;
  onSelect: (species: SpeciesOption) => void;
  onSearch?: () => void;
};

export function SpeciesSearch({ label, buttonLabel = "Buscar", showButton = true, options, selected, onSelect, onSearch }: Props) {
  const [query, setQuery] = useState(selected ? labelFor(selected) : "");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selected && query !== labelFor(selected)) {
      setQuery(labelFor(selected));
    }
  }, [selected]);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const hasSelectedQuery = useMemo(() => selected && query === labelFor(selected), [query, selected]);
  const filteredOptions = useMemo(() => {
    const term = normalize(query);
    return options
      .filter((option) => {
        const text = normalize(`${option.commonName} ${option.scientificName} ${option.family}`);
        return !term || text.includes(term);
      })
      .slice(0, 14);
  }, [options, query]);

  return (
    <div className="species-search" ref={wrapperRef}>
      <label className="field">
        <span>{label}</span>
        <div className={showButton ? "search-row" : "search-row single"}>
          <input
            aria-autocomplete="list"
            aria-expanded={open}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Ej: tomate, papa, albahaca"
            role="combobox"
            type="text"
            value={query}
          />
          {showButton ? (
            <button className="primary compact" disabled={!selected || !hasSelectedQuery} onClick={onSearch} type="button">
              <Search aria-hidden />
              {buttonLabel}
            </button>
          ) : null}
        </div>
      </label>

      {open && filteredOptions.length ? (
        <div className="suggestions" role="listbox">
          {filteredOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                onSelect(option);
                setQuery(labelFor(option));
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <strong>{option.commonName}</strong>
              <span>
                {option.scientificName} - {option.family}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function labelFor(species: SpeciesOption) {
  return `${species.commonName} (${species.scientificName})`;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
