import { getCommunes, getDepartments, getRegion, getRegionCorridors } from '../api/client'
import { useResource } from './hooks'
import type { CommuneSummary, Department, FeatureCollection, Region, RegionCorridorProps } from '../types'

export interface RegionData {
  region: Region | null
  communes: CommuneSummary[]
  departments: Department[]
  corridors: FeatureCollection<RegionCorridorProps> | null
  loading: boolean
}

/** Vue régionale : les 33 communes, les 5 départements et le réseau de couloirs. */
export function useRegionData(): RegionData {
  const regionRes = useResource(getRegion)
  const communesRes = useResource(getCommunes)
  const deptRes = useResource(getDepartments)
  const corridorsRes = useResource(getRegionCorridors)

  return {
    region: regionRes.data,
    communes: communesRes.data ?? [],
    departments: deptRes.data ?? [],
    corridors: corridorsRes.data,
    loading: communesRes.loading || regionRes.loading,
  }
}
