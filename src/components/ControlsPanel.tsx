import { useEffect, useMemo, useState, useTransition } from "react";
import { useGraphStore } from "../state/useGraphStore";

type ServerSearchOption = {
  id: string;
  name: string;
  displayName: string;
};

type ControlsPanelProps = {
  maxSharedCount: number;
  serverSearchOptions: ServerSearchOption[];
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const sliderToThreshold = (sliderValue: number, maxSharedCount: number): number => {
  if (maxSharedCount <= 1) return 1;
  const t = clamp(sliderValue, 0, 100) / 100;
  const normalized = Math.pow(t, 3);
  return clamp(1 + Math.round((maxSharedCount - 1) * normalized), 1, maxSharedCount);
};

const thresholdToSlider = (threshold: number, maxSharedCount: number): number => {
  if (maxSharedCount <= 1) return 0;
  const normalized = clamp((threshold - 1) / (maxSharedCount - 1), 0, 1);
  return Math.round(Math.cbrt(normalized) * 100);
};

const normalize = (value: string): string => value.trim().toLowerCase();

export const ControlsPanel = ({ maxSharedCount, serverSearchOptions }: ControlsPanelProps) => {
  const minSharedCount = useGraphStore((state) => state.minSharedCount);
  const setMinSharedCount = useGraphStore((state) => state.setMinSharedCount);
  const excludeBots = useGraphStore((state) => state.excludeBots);
  const setExcludeBots = useGraphStore((state) => state.setExcludeBots);
  const searchTerm = useGraphStore((state) => state.searchTerm);
  const setSearchTerm = useGraphStore((state) => state.setSearchTerm);
  const [searchInput, setSearchInput] = useState(searchTerm);
  const [isSearchPending, startSearchTransition] = useTransition();

  const cappedMax = Math.max(1, Math.floor(maxSharedCount));
  const safeMinShared = clamp(minSharedCount, 1, cappedMax);
  const sliderValue = useMemo(() => thresholdToSlider(safeMinShared, cappedMax), [cappedMax, safeMinShared]);

  useEffect(() => {
    setSearchInput(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    if (searchInput === searchTerm) return;
    const timer = window.setTimeout(() => {
      startSearchTransition(() => setSearchTerm(searchInput));
    }, 170);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchTerm, setSearchTerm, startSearchTransition]);

  const commitSearchImmediate = (value: string) => {
    setSearchInput(value);
    startSearchTransition(() => setSearchTerm(value));
  };

  const suggestions = useMemo(() => {
    const term = normalize(searchInput);
    if (!term) return serverSearchOptions.slice(0, 8);
    return serverSearchOptions
      .filter((server) => `${server.displayName} ${server.name} ${server.id}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [searchInput, serverSearchOptions]);

  return (
    <section className="panel">
      <h2>Explore</h2>

      <label className="field-label" htmlFor="search-term">
        Search server by name or ID
      </label>
      <div className="search-input-row">
        <input
          id="search-term"
          type="text"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search server..."
          autoComplete="off"
          aria-busy={isSearchPending}
        />
        <button
          type="button"
          className="ghost search-clear-button"
          onClick={() => commitSearchImmediate("")}
          disabled={!searchInput.trim()}
          aria-label="Clear search"
          title="Clear search"
        >
          Clear
        </button>
      </div>

      {suggestions.length > 0 ? (
        <div className="search-suggestions" aria-label="Search suggestions">
          {suggestions.map((server) => (
            <button
              key={server.id}
              type="button"
              className="suggestion-button"
              onClick={() => commitSearchImmediate(server.displayName)}
            >
              <span>{server.displayName}</span>
              <small>{server.id}</small>
            </button>
          ))}
        </div>
      ) : null}

      <label className="field-label" htmlFor="min-shared-slider">
        Minimum shared users: <strong>{safeMinShared}</strong>
      </label>
      <input
        id="min-shared-slider"
        type="range"
        min={0}
        max={100}
        value={sliderValue}
        onChange={(event) => {
          const value = Number(event.target.value);
          setMinSharedCount(sliderToThreshold(value, cappedMax));
        }}
      />

      <div className="row gap-sm threshold-row">
        <label htmlFor="min-shared-input" className="field-label no-margin">
          Exact minimum
        </label>
        <input
          id="min-shared-input"
          className="threshold-input"
          type="number"
          min={1}
          max={cappedMax}
          value={safeMinShared}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            setMinSharedCount(clamp(Math.floor(parsed), 1, cappedMax));
          }}
        />
        <span className="muted">/ {cappedMax}</span>
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={excludeBots} onChange={(event) => setExcludeBots(event.target.checked)} />
        <span>Exclude bots from user rankings and side panels</span>
      </label>

      <p className="muted tiny">Slider is lower-biased for fine control around small threshold values.</p>

    </section>
  );
};
