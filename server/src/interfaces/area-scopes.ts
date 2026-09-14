export interface AreaScopeActor {
  id: string;
  areaId: string;
  roleIds: string[];
  isSystemAdmin: boolean;
}

export interface ScopedArea {
  id: string;
  code: string;
  name: string;
}

export interface EffectiveAreaTypeScope {
  id: string;
  code: string;
  name: string;
  description: string | null;
  areas: ScopedArea[];
}
