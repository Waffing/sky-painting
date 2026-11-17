import { useCallback, useMemo, useState } from 'react'
import AppHeader from './components/AppHeader'
import AppFooter from './components/AppFooter'
import StudioView from './views/StudioView'
import GalleryView from './views/GalleryView'
import AboutView from './views/AboutView'
import { listWorks } from './utils/storage'

const VIEWS = [
  { id: 'studio', label: '创作台' },
  { id: 'gallery', label: '画廊' },
  { id: 'about', label: '关于' },
]

const VIEW_COMPONENTS = {
  studio: StudioView,
  gallery: GalleryView,
  about: AboutView,
}

export default function App() {
  const [view, setView] = useState('studio')
  const [worksVersion, setWorksVersion] = useState(0)
  const bumpWorks = useCallback(() => setWorksVersion((v) => v + 1), [])
  const goGallery = useCallback(() => setView('gallery'), [])
  // 角标只计真实作品，不含内置示例。
  const galleryCount = useMemo(() => {
    const listed = listWorks()
    return listed.ok ? listed.works.length : 0
  }, [worksVersion])
  const CurrentView = VIEW_COMPONENTS[view]

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-card focus:bg-paper focus:px-3 focus:py-2 focus:text-ink"
      >
        跳到主要内容
      </a>

      <AppHeader views={VIEWS} active={view} onChange={setView} counts={{ gallery: galleryCount }} />

      <main id="main" className="flex-1">
        {view === 'studio' ? (
          <StudioView onWorksChanged={bumpWorks} onGoGallery={goGallery} />
        ) : view === 'gallery' ? (
          <GalleryView worksVersion={worksVersion} onWorksChanged={bumpWorks} />
        ) : (
          <AboutView />
        )}
      </main>

      <AppFooter />
    </div>
  )
}
