import { useState, useEffect } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  Visibility,
  VisibilityOff,
  PersonOutlined,
  LockOutlined,
  Language as LanguageIcon,
} from '@mui/icons-material'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { login } from '../../store/authSlice'
import { loginApi } from '../../services/api'
import './LoginPage.css'

const loginSchema = z.object({
  email: z.string().email('Enter a valid work email.'),
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean().optional(),
})

type LoginFormValues = z.infer<typeof loginSchema>

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🌐' },
  { code: 'es', label: 'Español (Spanish)', flag: '🇪🇸' },
  { code: 'fr', label: 'Français (French)', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch (German)', flag: '🇩🇪' },
  { code: 'zh', label: '中文 (Chinese)', flag: '🇨🇳' },
  { code: 'hi', label: 'हिन्दी (Hindi)', flag: '🇮🇳' },
  { code: 'ar', label: 'العربية (Arabic)', flag: '🇸🇦' },
  { code: 'ru', label: 'Русский (Russian)', flag: '🇷🇺' },
]

function LoginPage() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [selectedLanguage, setSelectedLanguage] = useState('en')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  })

  // Ensure username and password are kept completely clear on initial load
  useEffect(() => {
    reset({ email: '', password: '', remember: false })
    setValue('email', '')
    setValue('password', '')

    // Wipe any aggressive browser auto-fill on load
    const clearTimer = setTimeout(() => {
      const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement | null
      const passInput = document.querySelector('input[type="password"]') as HTMLInputElement | null
      if (emailInput && emailInput.value === 'awsdevopskumar2026@gmail.com') {
        emailInput.value = ''
      }
      if (passInput && passInput.value) {
        passInput.value = ''
      }
    }, 120)

    return () => clearTimeout(clearTimer)
  }, [reset, setValue])

  const onSubmit = async (values: LoginFormValues) => {
    setLoginError('')
    try {
      const user = await loginApi(values.email, values.password, values.remember ?? false)
      dispatch(
        login({
          id: user.id,
          email: user.email,
          name: user.full_name,
          role: user.role,
        }),
      )
      navigate('/admin/dashboard', { replace: true })
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in.')
    }
  }

  return (
    <Box className="atlas-login">
      <svg className="atlas-map" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <pattern id="atlas-dots" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="9" cy="9" r="3.2" fill="#398bd1" />
          </pattern>
          <filter id="atlas-glow" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="15" />
          </filter>
        </defs>
        <g fill="url(#atlas-dots)" opacity=".8">
          <path d="M30 145 260 105 400 165 455 290 400 350 370 430 310 500 220 470 155 375 75 350 25 290Z" />
          <path d="M465 60 610 55 640 145 545 200Z" />
          <path d="M310 530 460 515 515 615 485 740 425 810 380 875 330 810 305 700 285 640Z" />
          <path d="M725 175 880 145 920 190 1050 125 1270 105 1510 170 1570 310 1510 385 1360 440 1230 445 1100 390 1030 350 980 270 890 280 810 240 740 255Z" />
          <path d="M755 300 890 285 970 335 1010 440 960 575 880 650 815 570 780 450Z" />
          <path d="M1350 590 1540 570 1590 700 1460 755 1350 705Z" />
        </g>
        <g fill="none" stroke="#19baff" strokeWidth="3">
          <path d="M200 260 Q510 35 840 240 Q1090 70 1360 300" />
          <path d="M400 660 Q615 430 880 490" />
        </g>
        {[ [200,260], [840,240], [1360,300], [400,660], [880,490] ].map(([cx,cy]) => (
          <g key={cx}>
            <circle cx={cx} cy={cy} r="24" fill="#13c4ff" filter="url(#atlas-glow)" />
            <circle cx={cx} cy={cy} r="7" fill="#effcff" />
          </g>
        ))}
      </svg>
      <Card className="atlas-card" elevation={0}>
        <Box className="atlas-heading">
          <svg width="58" height="58" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M45 8A25 25 0 1 0 56 43A22 22 0 0 1 17 42A24 24 0 0 1 45 8" fill="#238de5" />
            <path d="M12 49Q33 60 57 42Q42 69 12 57Z" fill="#18bdf4" />
            <circle cx="39" cy="20" r="5" fill="#ff9825" />
            <path d="m39 27-2 12 7 11m-7-11-6 10m7-19-9 7m9-7 10 7" fill="none" stroke="#ff9825" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <Typography className="atlas-brand">TRACKIN360</Typography>
          <Typography component="h1" className="atlas-title">Welcome back</Typography>
          
        </Box>
        <Box component="form" noValidate onSubmit={handleSubmit(onSubmit)} autoComplete="off">
          {/* Invisible dummy inputs to defeat aggressive browser auto-fill */}
          <input type="text" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
          <input type="password" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />

          <Stack spacing={2}>
            {loginError && <Alert severity="error">{loginError}</Alert>}
            <TextField
              placeholder="Email address"
              type="email"
              fullWidth
              autoComplete="new-password"
              {...register('email')}
              error={Boolean(errors.email)}
              helperText={errors.email?.message}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlined />
                    </InputAdornment>
                  ),
                },
                htmlInput: {
                  'aria-label': 'Email address',
                  autoComplete: 'new-password',
                  autoCorrect: 'off',
                  spellCheck: 'false',
                },
              }}
            />
            <TextField
              placeholder="Password"
              type={showPassword ? 'text' : 'password'}
              fullWidth
              autoComplete="new-password"
              {...register('password')}
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              slotProps={{
                htmlInput: {
                  'aria-label': 'Password',
                  autoComplete: 'new-password',
                },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlined />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword((value) => !value)}
                        edge="end"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Box className="atlas-options">
              <FormControlLabel
                control={<Checkbox size="small" {...register('remember')} />}
                label="Keep me signed in"
              />
              <Button
                className="atlas-forgot"
                onClick={() => setLoginError('Contact your administrator to reset your password.')}
              >
                Forgot password?
              </Button>
            </Box>

            {/* Language Switcher Dropdown with prompt text */}
            <Box className="atlas-language-box">
              
              <FormControl fullWidth size="small">
                <Select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="atlas-language-select"
                  startAdornment={
                    <InputAdornment position="start" sx={{ color: '#9bb3cf', ml: 0.5 }}>
                      <LanguageIcon fontSize="small" />
                    </InputAdornment>
                  }
                  title="Select Language"
                >
                  {LANGUAGES.map((lang) => (
                    <MenuItem key={lang.code} value={lang.code} sx={{ fontSize: '13px' }}>
                      <span style={{ marginRight: '8px' }}>{lang.flag}</span> {lang.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Button className="atlas-submit" type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </Stack>
        </Box>
      </Card>
    </Box>
  )
}

export default LoginPage
