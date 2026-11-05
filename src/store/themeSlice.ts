import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

type ThemeMode = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
}

const initialState: ThemeState = {
  mode: 'light',
}

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setMode: (state, action: PayloadAction<ThemeMode>) => {
      state.mode = action.payload
    },
    toggleMode: (state) => {
      state.mode = state.mode === 'light' ? 'dark' : 'light'
    },
  },
})

export const { setMode, toggleMode } = themeSlice.actions
export default themeSlice.reducer
