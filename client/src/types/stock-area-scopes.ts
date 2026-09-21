export interface StockScopedArea {
  id: string;
  code: string;
  name: string;
}

export interface StockAreaScopes {
  /** Areas whose stock this user may read, already resolved — never a sentinel. */
  areas: StockScopedArea[];
  /** The one Area this user may adjust, or null for an admin who may adjust any. */
  writableAreaId: string | null;
  readsAllAreas: boolean;
}
