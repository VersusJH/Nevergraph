import type {
  DatasetCatalog,
  GraphModel,
  JsonValue,
  MappingProfile,
} from "./types";

export type View = "landing" | "wizard" | "graph";
export type FilterMode = "hide" | "dim";
export type SizeBy = "uniform" | "degree" | string; // string => numeric field

export interface EncodingConfig {
  /** "type" or a facet name. */
  colorBy: string;
  sizeBy: SizeBy;
}

export interface FilterState {
  hiddenNodeTypes: Set<string>;
  hiddenEdgeTypes: Set<string>;
  /** facet name -> set of values toggled OFF. */
  facetOff: Record<string, Set<string>>;
  search: string;
  mode: FilterMode;
}

export interface Selection {
  kind: "node" | "edge";
  id: string;
}

export interface AppState {
  view: View;
  fileName: string | null;
  rawData: JsonValue | null;
  catalog: DatasetCatalog | null;
  profile: MappingProfile | null;
  graph: GraphModel | null;
  selection: Selection | null;
  encoding: EncodingConfig;
  filters: FilterState;
  layout: string;
}

export function initialState(): AppState {
  return {
    view: "landing",
    fileName: null,
    rawData: null,
    catalog: null,
    profile: null,
    graph: null,
    selection: null,
    encoding: { colorBy: "type", sizeBy: "degree" },
    filters: {
      hiddenNodeTypes: new Set(),
      hiddenEdgeTypes: new Set(),
      facetOff: {},
      search: "",
      mode: "hide",
    },
    layout: "physics",
  };
}

type Listener = (state: AppState) => void;

/** Minimal observable store. Subscribers are notified after every change. */
export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(state: AppState = initialState()) {
    this.state = state;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Mutate in place (for nested Set/Record changes) then notify. */
  update(fn: (s: AppState) => void): void {
    fn(this.state);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
