import { useCallback, useEffect, useState } from 'react'

export function useApiData<T>(load: () => Promise<T>) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [result, setResult] = useState<{
    load: typeof load
    refreshKey: number
    data: T | null
    loading: boolean
    error: string
  }>({ load, refreshKey, data: null, loading: true, error: '' })

  useEffect(() => {
    let active = true
    load()
      .then((value) => {
        if (active) setResult({ load, refreshKey, data: value, loading: false, error: '' })
      })
      .catch((reason: unknown) => {
        if (active) {
          setResult({
            load,
            refreshKey,
            data: null,
            loading: false,
            error: reason instanceof Error ? reason.message : 'The request failed.',
          })
        }
      })

    return () => {
      active = false
    }
  }, [load, refreshKey])

  const reload = useCallback(() => setRefreshKey((key) => key + 1), [])
  const isCurrent = result.load === load && result.refreshKey === refreshKey

  return {
    data: isCurrent ? result.data : null,
    loading: !isCurrent || result.loading,
    error: isCurrent ? result.error : '',
    reload,
  }
}
