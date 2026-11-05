import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/oswald/500.css'
import '@fontsource/oswald/700.css'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import { MainApp } from './MainApp'
import { OverlayApp } from './OverlayApp'

const view = new URLSearchParams(location.search).get('view')
document.body.classList.add(view === 'overlay' ? 'overlay' : 'main')

createRoot(document.getElementById('root')!).render(view === 'overlay' ? <OverlayApp /> : <MainApp />)
