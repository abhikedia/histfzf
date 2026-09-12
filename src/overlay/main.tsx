import { createRoot } from 'react-dom/client'
import App from './App'
import './overlay.css'

// No StrictMode: it double-invokes effects in dev, which would send
// GET_INDEX (and later every palette message) twice per open.
createRoot(document.getElementById('root')!).render(<App />)
