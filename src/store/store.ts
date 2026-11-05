import { configureStore } from '@reduxjs/toolkit'
import authReducer from './authSlice'
import themeReducer from './themeSlice'

const persistedTheme = (() => {
  if (typeof window === 'undefined') {
    return 'light' as const
  }

  const storedTheme = window.localStorage.getItem('trackin360-theme')
  return storedTheme === 'dark' ? ('dark' as const) : ('light' as const)
})()

export const store = configureStore({
  reducer: {
    auth: authReducer,
    theme: themeReducer,
  },
  preloadedState: {
    auth: { isAuthenticated: false, user: null },
    theme: { mode: persistedTheme },
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
