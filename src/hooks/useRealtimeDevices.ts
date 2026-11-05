import { useEffect, useState } from 'react'
import { subscribeToDevices } from '../lib/firebase'
import { listDevices, type Device } from '../services/api'

export interface RealtimeDevicesState {
  devices: Device[]
  loading: boolean
  error: Error | null
  isLive: boolean
  lastUpdated: Date | null
}

/**
 * Custom hook that subscribes to Firestore real-time updates for devices.
 * Gracefully falls back to REST API if Firestore is unavailable or errors out.
 * Cleans up the onSnapshot listener automatically on unmount.
 */
export function useRealtimeDevices(): RealtimeDevicesState {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)
  const [isLive, setIsLive] = useState<boolean>(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    let isMounted = true
    let unsubscribe: (() => void) | null = null

    try {
      unsubscribe = subscribeToDevices(
        (updatedDevices) => {
          if (!isMounted) return
          setDevices(updatedDevices)
          setLoading(false)
          setError(null)
          setIsLive(true)
          setLastUpdated(new Date())
        },
        async (err) => {
          if (!isMounted) return
          console.warn('Firestore real-time listener failed, falling back to REST API:', err)
          setError(err)
          setIsLive(false)

          // Fallback to REST API if Firestore listener hits an error (e.g. security rule or offline)
          try {
            const apiDevices = await listDevices(0, 500)
            if (isMounted) {
              setDevices(apiDevices)
              setLoading(false)
            }
          } catch (apiErr) {
            if (isMounted) {
              setLoading(false)
            }
          }
        }
      )
    } catch (err) {
      if (isMounted) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
        setIsLive(false)
      }
    }

    return () => {
      isMounted = false
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [])

  return { devices, loading, error, isLive, lastUpdated }
}

