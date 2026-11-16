import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { TocItem } from 'foliate-js/epub.js'
import { openEpub } from '#lib/reader/epub'
import type { EpubSession } from '#lib/reader/epub-types'
import type { ReaderSettings } from '#lib/reader/preferences'
import { bindHostInput } from '#lib/reader/input'
import { openImageArchive } from '#lib/reader/archive'
import { animatePage, type SwipeDirection } from '#lib/reader/motion'
import { columnsForWidth, nextLead, visibleIndices } from '#lib/reader/layout'
import { Icon } from '#components/reader/Icon'
import { ReaderProgress } from '#components/reader/ReaderProgress'
import styles from '#components/reader/Reader.module.css'

type Archive = Awaited<ReturnType<typeof openImageArchive>>
type Session =
  { kind: 'zip'; archive: Archive } | { kind: 'epub'; epub: EpubSession }
interface ReaderProps {
  file: File
  settings: ReaderSettings
  active: boolean
  onClose: () => void
  onSettings: () => void
}

const messageFor = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'ファイルを開けませんでした。'

interface TocProps {
  items: TocItem[]
  goTo: (href: string) => void
}

const Toc = ({ items, goTo }: TocProps) => (
  <>
    {items.map((item, index) => (
      <div key={`${item.href}-${index}`}>
        <button onClick={() => goTo(item.href)}>{item.label}</button>
        {item.subitems?.length ? (
          <div className={styles.subToc}>
            <Toc items={item.subitems} goTo={goTo} />
          </div>
        ) : null}
      </div>
    ))}
  </>
)

interface ZipRefs {
  generation: MutableRefObject<number>
  session: MutableRefObject<Session | null>
  queue: MutableRefObject<Promise<void>>
  lead: MutableRefObject<number>
  columns: MutableRefObject<1 | 2>
  animation: MutableRefObject<Animation | null>
  swipe: MutableRefObject<SwipeDirection | null>
  imageRequest: MutableRefObject<number>
  active: MutableRefObject<boolean>
  firstPageSingle: MutableRefObject<boolean>
}
interface ZipSetters {
  setIndices: Dispatch<SetStateAction<number[]>>
  setUrls: Dispatch<SetStateAction<string[]>>
  setProgress: Dispatch<SetStateAction<number>>
  setAtStart: Dispatch<SetStateAction<boolean>>
  setAtEnd: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
}
const updateZip = async (
  archive: Archive,
  lead: number,
  id: number,
  refs: ZipRefs,
  setters: ZipSetters,
  swipeDirection?: SwipeDirection,
) => {
  const request = ++refs.imageRequest.current
  const columns = refs.columns.current
  const count = refs.firstPageSingle.current && lead === 0 ? 1 : columns
  const indices = visibleIndices(lead, archive.names.length, count)
  const urls = await Promise.all(indices.map((index) => archive.getUrl(index)))
  if (
    refs.generation.current !== id ||
    refs.imageRequest.current !== request ||
    refs.session.current?.kind !== 'zip'
  )
    return
  refs.lead.current = lead
  refs.swipe.current = swipeDirection ?? null
  setters.setError('')
  setters.setIndices(indices)
  setters.setUrls(urls)
  setters.setProgress(
    Math.round(((lead + indices.length) / archive.names.length) * 100),
  )
  setters.setAtStart(lead === 0)
  setters.setAtEnd(lead + indices.length >= archive.names.length)
}
const scheduleZipUpdate = (refs: ZipRefs, setters: ZipSetters) => {
  const id = refs.generation.current
  refs.queue.current = refs.queue.current
    .then(async () => {
      if (!refs.active.current || refs.generation.current !== id) return
      const current = refs.session.current
      if (current?.kind !== 'zip') return
      await updateZip(current.archive, refs.lead.current, id, refs, setters)
    })
    .catch((cause) => {
      if (refs.generation.current === id) setters.setError(messageFor(cause))
    })
}

const scheduleTurn = (
  next: boolean,
  swipeDirection: SwipeDirection | undefined,
  refs: ZipRefs,
  setters: ZipSetters,
) => {
  const id = refs.generation.current
  refs.queue.current = refs.queue.current
    .then(async () => {
      if (!refs.active.current || refs.generation.current !== id) return
      const current = refs.session.current
      if (!current) return
      if (current.kind === 'epub') {
        await (next ? current.epub.next() : current.epub.prev())
        return
      }
      const currentLead = refs.lead.current
      const cover =
        refs.firstPageSingle.current &&
        refs.columns.current === 2 &&
        currentLead === 0
      const step = cover ? 1 : refs.columns.current
      const minimumPreviousLead =
        !next &&
        refs.firstPageSingle.current &&
        refs.columns.current === 2 &&
        currentLead > 1
          ? 1
          : 0
      const lead = next
        ? nextLead(currentLead, current.archive.names.length, step)
        : Math.max(minimumPreviousLead, currentLead - step)
      if (lead === refs.lead.current) return
      refs.animation.current?.cancel()
      refs.animation.current = null
      await updateZip(current.archive, lead, id, refs, setters, swipeDirection)
    })
    .catch((cause) => {
      if (refs.generation.current === id) setters.setError(messageFor(cause))
    })
}

interface ReaderStageProps {
  archive: Archive | null
  indices: number[]
  urls: string[]
  host: React.RefObject<HTMLDivElement | null>
  padding: string
  gutter: number
  count: number
  loading: boolean
  error: string
  setError: Dispatch<SetStateAction<string>>
  cover: boolean
}

const ReaderStage = ({
  archive,
  indices,
  urls,
  host,
  padding,
  gutter,
  count,
  loading,
  error,
  setError,
  cover,
}: ReaderStageProps) => (
  <main
    className={styles.pages}
    aria-label="読書ページ"
    ref={host}
    style={{ padding }}
  >
    {archive && (
      <div
        className={styles.imagePair}
        style={{
          gap: gutter,
          width: cover ? `calc((100% - ${gutter}px) / 2)` : undefined,
        }}
      >
        {urls.map((url, index) => (
          <img
            key={indices[index]}
            className={styles.pageImage}
            src={url}
            alt={`画像 ${indices[index] + 1} / ${count}`}
            onError={() => setError('画像を読み込めませんでした。')}
          />
        ))}
      </div>
    )}
    {loading && (
      <p className={styles.message} role="status">
        本を開いています…
      </p>
    )}
    {error && (
      <p className={styles.error} role="alert">
        {error}
      </p>
    )}
  </main>
)

const openReaderFile = async ({
  file,
  id,
  active,
  settings,
  host,
  signal,
  refs,
  setters,
  setArchive,
  setToc,
  setDirection,
}: {
  file: File
  id: number
  active: boolean
  settings: ReaderSettings
  host: HTMLElement
  signal: AbortSignal
  refs: ZipRefs
  setters: ZipSetters
  setArchive: Dispatch<SetStateAction<Archive | null>>
  setToc: Dispatch<SetStateAction<TocItem[]>>
  setDirection: Dispatch<SetStateAction<'ltr' | 'rtl'>>
}) => {
  if (file.name.toLowerCase().endsWith('.zip')) {
    const archive = await openImageArchive(file)
    if (signal.aborted) {
      await archive.close()
      return
    }
    refs.session.current = { kind: 'zip', archive }
    setArchive(archive)
    await updateZip(archive, 0, id, refs, setters)
  } else if (file.name.toLowerCase().endsWith('.epub')) {
    const epub = await openEpub({
      file,
      host,
      settings,
      columns: refs.columns.current,
      active,
      signal,
      onLocation: (location) => {
        if (signal.aborted || refs.generation.current !== id) return
        setters.setProgress(Math.round(location.progress))
        setters.setAtStart(location.atStart)
        setters.setAtEnd(location.atEnd)
      },
      onError: (cause) => {
        if (!signal.aborted && refs.generation.current === id)
          setters.setError(cause.message)
      },
    })
    if (signal.aborted) {
      await epub.close()
      return
    }
    refs.session.current = { kind: 'epub', epub }
    setDirection(epub.dir)
    setToc(epub.toc)
  } else throw new Error('EPUBまたは画像ZIPを選んでください。')
}

const useResizeColumns = (
  host: React.RefObject<HTMLDivElement | null>,
  settings: ReaderSettings,
  columnsRef: MutableRefObject<1 | 2>,
  setColumns: Dispatch<SetStateAction<1 | 2>>,
) => {
  useEffect(() => {
    const node = host.current
    if (!node) return
    const observe = (width: number) => {
      const count = columnsForWidth(settings.spread, width)
      columnsRef.current = count
      setColumns(count)
    }
    const observer = new ResizeObserver(([entry]) =>
      observe(entry.contentRect.width),
    )
    observer.observe(node)
    const computed = getComputedStyle(node)
    observe(
      node.clientWidth -
        Number.parseFloat(computed.paddingLeft) -
        Number.parseFloat(computed.paddingRight),
    )
    return () => observer.disconnect()
  }, [settings.spread, settings.marginLeft, settings.marginRight])
}
const useOpenFile = ({
  file,
  active,
  settings,
  host,
  refs,
  setters,
  setArchive,
  setToc,
  setUrls,
  setShowToc,
  setLoading,
  setDirection,
}: {
  file: File
  active: boolean
  settings: ReaderSettings
  host: React.RefObject<HTMLDivElement | null>
  refs: ZipRefs
  setters: ZipSetters
  setArchive: Dispatch<SetStateAction<Archive | null>>
  setToc: Dispatch<SetStateAction<TocItem[]>>
  setUrls: Dispatch<SetStateAction<string[]>>
  setShowToc: Dispatch<SetStateAction<boolean>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setDirection: Dispatch<SetStateAction<'ltr' | 'rtl'>>
}) => {
  useEffect(() => {
    const controller = new AbortController()
    const id = ++refs.generation.current
    setLoading(true)
    setters.setError('')
    setters.setProgress(0)
    setters.setAtStart(true)
    setters.setAtEnd(false)
    setArchive(null)
    setUrls([])
    setters.setIndices([])
    setToc([])
    setDirection('ltr')
    setShowToc(false)
    refs.lead.current = 0
    void openReaderFile({
      file,
      id,
      active,
      settings,
      host: host.current!,
      signal: controller.signal,
      refs,
      setters,
      setArchive,
      setToc,
      setDirection,
    })
      .then(() => {
        if (!controller.signal.aborted && refs.generation.current === id)
          setLoading(false)
      })
      .catch((cause) => {
        if (refs.generation.current !== id || controller.signal.aborted) return
        setters.setError(messageFor(cause))
        setLoading(false)
      })
    return () => {
      controller.abort()
      refs.generation.current++
      refs.animation.current?.cancel()
      refs.animation.current = null
      refs.swipe.current = null
      const previous = refs.session.current
      refs.session.current = null
      if (previous?.kind === 'zip') void previous.archive.close()
      if (previous?.kind === 'epub') void previous.epub.close()
    }
  }, [file])
}

const navigationDisabled = (
  loading: boolean,
  atBoundary: boolean,
  fatalError: boolean,
) => loading || atBoundary || fatalError

interface ReaderControlsProps {
  onClose: () => void
  onSettings: () => void
  toc: TocItem[]
  showToc: boolean
  toggleToc: () => void
  goTo: (href: string) => void
  loading: boolean
  atStart: boolean
  atEnd: boolean
  hasSession: boolean
  error: string
  turn: (next: boolean) => void
  count: number
  currentIndex: number
  indices: number[]
  progress: number
  direction: 'ltr' | 'rtl'
  title: string
  dialog: React.RefObject<HTMLDialogElement | null>
  closeToc: () => void
  children: ReactNode
}

const ReaderControls = ({
  title,
  dialog,
  closeToc,
  children,
  onClose,
  onSettings,
  toc,
  showToc,
  toggleToc,
  goTo,
  loading,
  atStart,
  atEnd,
  hasSession,
  error,
  turn,
  count,
  currentIndex,
  indices,
  progress,
  direction,
}: ReaderControlsProps) => (
  <>
    <header className={styles.toolbar}>
      <button aria-label="本を閉じる" title="本を閉じる" onClick={onClose}>
        <Icon name="close" />
      </button>
      <span className={styles.bookTitle} title={title}>
        {title}
      </span>
      <div className={styles.toolbarActions}>
        <button
          aria-label="目次"
          title="目次"
          aria-haspopup="dialog"
          aria-expanded={showToc}
          aria-controls="reader-toc-dialog"
          disabled={toc.length === 0}
          onClick={toggleToc}
        >
          <Icon name="toc" />
        </button>
        <button aria-label="設定" title="設定" onClick={onSettings}>
          <Icon name="settings" />
        </button>
      </div>
    </header>
    {children}
    <footer className={styles.footer} dir={direction}>
      <button
        aria-label="前へ"
        title="前へ"
        disabled={navigationDisabled(
          loading,
          atStart,
          Boolean(error) && !hasSession,
        )}
        onClick={() => turn(false)}
      >
        <Icon name={direction === 'rtl' ? 'next' : 'prev'} /> 前へ
      </button>
      <ReaderProgress
        count={count}
        currentIndex={currentIndex}
        indices={indices}
        progress={progress}
        atEnd={atEnd}
        loading={loading}
        unavailable={Boolean(error) && !hasSession}
        direction={direction}
      />
      <button
        aria-label="次へ"
        title="次へ"
        disabled={navigationDisabled(
          loading,
          atEnd,
          Boolean(error) && !hasSession,
        )}
        onClick={() => turn(true)}
      >
        <Icon name={direction === 'rtl' ? 'prev' : 'next'} /> 次へ
      </button>
    </footer>
    <dialog
      ref={dialog}
      id="reader-toc-dialog"
      className={styles.tocDialog}
      tabIndex={-1}
      aria-labelledby="reader-toc-heading"
      onCancel={(event) => {
        event.preventDefault()
        closeToc()
      }}
      onClose={closeToc}
      onKeyDownCapture={(event) => event.stopPropagation()}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          closeToc()
      }}
    >
      <div className={styles.tocHeading}>
        <h2 id="reader-toc-heading">目次</h2>
        <button aria-label="目次を閉じる" onClick={closeToc}>
          閉じる
        </button>
      </div>
      <nav aria-label="目次">
        <Toc items={toc} goTo={goTo} />
      </nav>
    </dialog>
  </>
)

export const Reader = ({
  file,
  settings,
  active,
  onClose,
  onSettings,
}: ReaderProps) => {
  const host = useRef<HTMLDivElement>(null)
  const tocDialog = useRef<HTMLDialogElement>(null)
  const session = useRef<Session | null>(null)
  const generation = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const leadRef = useRef(0)
  const columnsRef = useRef<1 | 2>(1)
  const animation = useRef<Animation | null>(null)
  const swipe = useRef<SwipeDirection | null>(null)
  const imageRequest = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const firstPageSingleRef = useRef(settings.firstPageSingle)
  firstPageSingleRef.current = settings.firstPageSingle
  const [columns, setColumns] = useState<1 | 2>(1)
  const [archive, setArchive] = useState<Archive | null>(null)
  const [urls, setUrls] = useState<string[]>([])
  const [indices, setIndices] = useState<number[]>([])
  const [toc, setToc] = useState<TocItem[]>([])
  const [showToc, setShowToc] = useState(false)
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr')
  const [progress, setProgress] = useState(0)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refs: ZipRefs = {
    generation,
    session,
    queue,
    lead: leadRef,
    columns: columnsRef,
    animation,
    swipe,
    imageRequest,
    active: activeRef,
    firstPageSingle: firstPageSingleRef,
  }
  const setters: ZipSetters = {
    setIndices,
    setUrls,
    setProgress,
    setAtStart,
    setAtEnd,
    setError,
  }
  const turn = (next: boolean, swipeDirection?: SwipeDirection) =>
    scheduleTurn(next, swipeDirection, refs, setters)

  useEffect(() => {
    const element = tocDialog.current
    if (!element) return
    if (!active && showToc) {
      setShowToc(false)
      return
    }
    if (showToc && !element.open) element.showModal()
    if (!showToc && element.open) element.close()
  }, [active, showToc])

  useResizeColumns(host, settings, columnsRef, setColumns)
  useEffect(() => {
    const current = session.current
    if (current?.kind === 'epub') void current.epub.configure(settings, columns)
    if (current?.kind === 'zip' && archive) scheduleZipUpdate(refs, setters)
  }, [settings, columns, loading])

  useEffect(() => {
    const current = session.current
    if (current?.kind === 'epub') current.epub.setActive(active)
    if (!active) {
      animation.current?.cancel()
      animation.current = null
      swipe.current = null
      return
    }
    if (!host.current || current?.kind !== 'zip') return
    scheduleZipUpdate(refs, setters)
    return bindHostInput(host.current, 'ltr', turn)
  }, [active, loading])

  useOpenFile({
    file,
    active,
    settings,
    host,
    refs,
    setters,
    setArchive,
    setToc,
    setUrls,
    setShowToc,
    setLoading,
    setDirection,
  })

  useLayoutEffect(() => {
    const direction = swipe.current
    swipe.current = null
    if (direction && activeRef.current)
      animatePage(
        host.current?.querySelector(`.${styles.imagePair}`) ?? null,
        direction,
        animation,
      )
  }, [urls])

  const goTo = (href: string) => {
    setShowToc(false)
    const current = session.current
    if (current?.kind === 'epub') void current.epub.goTo(href)
  }
  const currentIndex = indices[0] ?? leadRef.current
  const count = archive?.names.length ?? 0
  const title = file.name.replace(/\.(epub|zip)$/i, '')
  const padding = `${settings.marginTop}px ${settings.marginRight}px ${settings.marginBottom}px ${settings.marginLeft}px`
  return (
    <section className={styles.reader} aria-label="読書画面">
      <h1 className={styles.srOnly}>{file.name}</h1>
      <ReaderControls
        onClose={onClose}
        onSettings={onSettings}
        toc={toc}
        showToc={showToc}
        toggleToc={() => setShowToc(!showToc)}
        goTo={goTo}
        loading={loading}
        atStart={atStart}
        atEnd={atEnd}
        hasSession={session.current !== null}
        error={error}
        turn={turn}
        count={count}
        currentIndex={currentIndex}
        indices={indices}
        progress={progress}
        direction={direction}
        title={title}
        dialog={tocDialog}
        closeToc={() => setShowToc(false)}
      >
        <ReaderStage
          archive={archive}
          indices={indices}
          urls={urls}
          host={host}
          padding={padding}
          gutter={settings.gutter}
          count={count}
          loading={loading}
          error={error}
          setError={setError}
          cover={
            settings.firstPageSingle && columns === 2 && currentIndex === 0
          }
        />
      </ReaderControls>
    </section>
  )
}
