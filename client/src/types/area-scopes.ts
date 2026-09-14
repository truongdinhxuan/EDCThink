export interface AreaScopeArea {
  id: string;
  code: string;
  name: string;
}

export interface AreaTypeScope {
  id: string;
  code: string;
  name: string;
  description: string | null;
  areas: AreaScopeArea[];
}

export interface EffectiveAreaScopesResponse {
  areaTypes: AreaTypeScope[];
}

export interface AreaTypeSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
}
