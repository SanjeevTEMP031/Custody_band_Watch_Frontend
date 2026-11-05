import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface UserProfile {
  id?: number
  email: string
  name: string
  role: string
}

interface AuthState {
  isAuthenticated: boolean
  user: UserProfile | null
}

const initialState: AuthState = {
  isAuthenticated: typeof window !== 'undefined' && Boolean(
    window.localStorage.getItem('trackin360-access-token')
      ?? window.sessionStorage.getItem('trackin360-access-token'),
  ),
  user: null,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<UserProfile>) => {
      state.isAuthenticated = true
      state.user = action.payload
    },
    setUser: (state, action: PayloadAction<UserProfile>) => {
      state.user = action.payload
      state.isAuthenticated = true
    },
    logout: (state) => {
      state.isAuthenticated = false
      state.user = null
    },
  },
})

export const { login, logout, setUser } = authSlice.actions
export default authSlice.reducer
