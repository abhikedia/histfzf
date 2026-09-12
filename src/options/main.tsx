import { createRoot } from 'react-dom/client'
import App from './App'
import './options.css'

// No StrictMode: double effects would read storage twice per open.
createRoot(document.getElementById('root')!).render(<App />)
