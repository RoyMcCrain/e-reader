import { useEffect, useRef, useState } from 'react'
import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js'
import type {
  EPUB as EpubConstructor,
  EpubBook,
  TocItem,
} from 'foliate-js/epub.js'
import type { FoliateViewElement } from 'foliate-js/view.js'
import { bindEpubInput, bindHostInput } from './input'
import styles from './Reader.module.css'
import { openImageArchive } from './archive'
import { secureDocument } from './security'

interface ReaderProps {
  file: File
  onClose: () => void
}
type Archive = Awaited<ReturnType<typeof openImageArchive>>
type Session =
  | {
      kind: 'epub'
      book: InstanceType<typeof EpubConstructor>
      view: FoliateViewElement
      reader: ZipReader<BlobReader>
      removeInput: () => void
    }
  | { kind: 'zip'; archive: Archive }

const checkCancelled = (isCancelled: () => boolean) => {
  if (isCancelled()) throw new Error('読み込みがキャンセルされました。')
}

const installContentHooks = (book: EpubBook) => {
  book.transformTarget.addEventListener('data', (event: Event) => {
    const detail = (
      event as CustomEvent<{
        data: Blob | string | Promise<Blob | string>
        type: string
      }>
    ).detail
    if (
      !['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(
        detail.type,
      )
    )
      return
    detail.data = Promise.resolve(detail.data)
      .then(async (data) =>
        secureDocument(
          typeof data === 'string' ? data : await data.text(),
          detail.type,
        ),
      )
      .then((text) => new Blob([text], { type: detail.type }))
  })
  book.transformTarget.addEventListener('load', (event: Event) => {
    const detail = (
      event as CustomEvent<{ isScript?: boolean; allow?: boolean }>
    ).detail
    if (detail.isScript) detail.allow = false
  })
}

const configureEpubView = (
  host: HTMLElement,
  progress: (value: number) => void,
) => {
  const view = document.createElement('foliate-view') as FoliateViewElement
  host.append(view)
  view.addEventListener('relocate', (event) => {
    const detail = (event as CustomEvent<{ fraction?: number }>).detail
    progress(Math.round((detail.fraction ?? 0) * 100))
  })
  view.addEventListener('external-link', (event) => event.preventDefault())
  return view
}

const initializeEpub = async (
  book: InstanceType<typeof EpubConstructor>,
  reader: ZipReader<BlobReader>,
  host: HTMLElement,
  progress: (value: number) => void,
  isCancelled: () => boolean,
  turn: (next: boolean) => void,
): Promise<Session> => {
  let view: FoliateViewElement | null = null
  let removeInput: (() => void) | undefined
  try {
    await book.init()
    installContentHooks(book)
    checkCancelled(isCancelled)
    view = configureEpubView(host, progress)
    await view.open(book)
    const renderer = view.renderer!
    renderer.setAttribute('max-column-count', '1')
    renderer.setAttribute('flow', 'paginated')
    renderer.setAttribute('gap', '5%')
    removeInput = bindEpubInput(
      view,
      host,
      book.dir === 'rtl' ? 'rtl' : 'ltr',
      turn,
    )
    await view.init({ showTextStart: false })
    return { kind: 'epub', book, view, reader, removeInput }
  } catch (cause) {
    removeInput?.()
    view?.close()
    view?.remove()
    try {
      book.destroy()
    } catch {
      // Initialization may fail before the book is destroyable.
    }
    try {
      await reader.close()
    } catch {
      // Preserve the initialization error.
    }
    throw cause
  }
}

const loadEpub = async (
  file: File,
  host: HTMLElement,
  progress: (value: number) => void,
  isCancelled: () => boolean,
  turn: (next: boolean) => void,
): Promise<Session> => {
  const [module] = await Promise.all([
    import('foliate-js/epub.js'),
    import('foliate-js/view.js').then(() => undefined),
  ])
  checkCancelled(isCancelled)
  const reader = new ZipReader(new BlobReader(file))
  let entries: Awaited<ReturnType<typeof reader.getEntries>>
  try {
    entries = await reader.getEntries()
  } catch (cause) {
    try {
      await reader.close()
    } catch {
      // Preserve the entry-loading error.
    }
    throw cause
  }
  if (isCancelled()) {
    await reader.close()
    checkCancelled(() => true)
  }
  if (
    entries.length > 5000 ||
    entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0) >
      1_000_000_000
  ) {
    await reader.close()
    throw new Error('EPUBの展開サイズが上限を超えています。')
  }
  const map = new Map(entries.map((entry) => [entry.filename, entry]))
  const getText = async (path: string) => {
    const entry = map.get(path)
    return entry && !entry.directory
      ? (entry as FileEntry).getData(new TextWriter())
      : null
  }
  const getBlob = async (path: string) => {
    const entry = map.get(path)
    return entry && !entry.directory
      ? (entry as FileEntry).getData(new BlobWriter())
      : null
  }
  const book = new module.EPUB({
    loadText: getText,
    loadBlob: getBlob,
    getSize: (path) => map.get(path)?.uncompressedSize ?? 0,
  })
  return initializeEpub(book, reader, host, progress, isCancelled, turn)
}

const Toc = ({
  items,
  goTo,
}: {
  items: TocItem[]
  goTo: (href: string) => void
}) => (
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

export const Reader = ({ file, onClose }: ReaderProps) => {
  const host = useRef<HTMLDivElement>(null)
  const session = useRef<Session | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pageRef = useRef(0)
  const imageRequest = useRef(0)
  const generation = useRef(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [direction, setDirection] = useState<'rtl' | 'ltr'>('ltr')
  const [archive, setArchive] = useState<Archive | null>(null)
  const [page, setPage] = useState(0)
  const [imageUrl, setImageUrl] = useState('')
  const [toc, setToc] = useState<TocItem[]>([])
  const [showToc, setShowToc] = useState(false)
  const enqueue = (action: () => Promise<void>) => {
    const currentGeneration = generation.current
    queue.current = queue.current
      .then(() =>
        currentGeneration === generation.current ? action() : undefined,
      )
      .catch((cause) => {
        if (currentGeneration === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'ページを表示できませんでした。',
          )
      })
  }
  const turn = (next: boolean) =>
    enqueue(async () => {
      const current = session.current
      if (!current) return
      if (current.kind === 'epub')
        await (next ? current.view.next() : current.view.prev())
      else {
        const destination = Math.max(
          0,
          Math.min(
            current.archive.names.length - 1,
            pageRef.current + (next ? 1 : -1),
          ),
        )
        if (destination === pageRef.current) return
        pageRef.current = destination
        setPage(destination)
        const request = ++imageRequest.current
        const url = await current.archive.getUrl(destination)
        if (request === imageRequest.current && current === session.current)
          setImageUrl(url)
        setProgress(
          Math.round(((destination + 1) / current.archive.names.length) * 100),
        )
      }
    })

  useEffect(() => {
    setError('')
    setLoading(true)
    setProgress(0)
    setDirection('ltr')
    setArchive(null)
    pageRef.current = 0
    setPage(0)
    setImageUrl('')
    setToc([])
    setShowToc(false)
    imageRequest.current += 1
    const currentGeneration = ++generation.current
    let cancelled = false
    let opened: Session | null = null
    const open = async () => {
      const result = file.name.toLowerCase().endsWith('.zip')
        ? { kind: 'zip' as const, archive: await openImageArchive(file) }
        : file.name.toLowerCase().endsWith('.epub')
          ? await loadEpub(
              file,
              host.current!,
              setProgress,
              () => cancelled,
              turn,
            )
          : (() => {
              throw new Error('EPUBまたは画像ZIPを選んでください。')
            })()
      opened = result
      if (cancelled) {
        await dispose(result)
        return
      }
      session.current = result
      if (result.kind === 'zip') {
        setArchive(result.archive)
        const url = await result.archive.getUrl(0)
        if (!cancelled) setImageUrl(url)
      } else {
        setDirection(result.book.dir === 'rtl' ? 'rtl' : 'ltr')
        setToc(result.book.toc ?? [])
      }
      if (!cancelled) setLoading(false)
    }
    void open().catch(async (cause) => {
      if (opened) {
        if (session.current === opened) session.current = null
        await dispose(opened)
        opened = null
      }
      if (!cancelled) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'ファイルを開けませんでした。',
        )
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      if (generation.current === currentGeneration) generation.current += 1
      session.current = null
      if (opened) void dispose(opened)
    }
  }, [file])

  useEffect(() => {
    if (!host.current) return
    const removeHostInput = bindHostInput(host.current, direction, turn)
    return () => removeHostInput()
  }, [loading, direction])

  const goTo = (href: string) => {
    setShowToc(false)
    enqueue(async () => {
      if (session.current?.kind === 'epub')
        await session.current.view.goTo(href)
    })
  }
  return (
    <ReaderLayout
      file={file}
      onClose={onClose}
      direction={direction}
      toc={toc}
      showToc={showToc}
      toggleToc={() => setShowToc(!showToc)}
      goTo={goTo}
      host={host}
      archive={archive}
      imageUrl={imageUrl}
      page={page}
      loading={loading}
      error={error}
      setError={setError}
      progress={progress}
      turn={turn}
    />
  )
}

interface ToolbarProps {
  file: File
  onClose: () => void
  direction: 'rtl' | 'ltr'
  toc: TocItem[]
  showToc: boolean
  toggleToc: () => void
  goTo: (href: string) => void
}
const ReaderToolbar = ({
  file,
  onClose,
  direction,
  toc,
  showToc,
  toggleToc,
  goTo,
}: ToolbarProps) => (
  <>
    <header className={styles.toolbar}>
      <button onClick={onClose} aria-label="本を閉じる">
        ← 閉じる
      </button>
      <span className={styles.bookTitle}>
        {file.name} ·{' '}
        {file.name.toLowerCase().endsWith('.zip')
          ? '画像ZIP'
          : `EPUB・${direction === 'rtl' ? '右から左' : '左から右'}`}
      </span>
      {toc.length > 0 && (
        <button onClick={toggleToc} aria-expanded={showToc}>
          目次
        </button>
      )}
    </header>
    {showToc && (
      <nav
        className={styles.toc}
        aria-label="目次"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Toc items={toc} goTo={goTo} />
      </nav>
    )}
  </>
)
interface PageProps {
  host: React.RefObject<HTMLDivElement | null>
  archive: Archive | null
  imageUrl: string
  page: number
  loading: boolean
  error: string
  setError: (value: string) => void
}
const ReaderPage = ({
  host,
  archive,
  imageUrl,
  page,
  loading,
  error,
  setError,
}: PageProps) => (
  <main className={styles.pages} aria-label="読書ページ" ref={host}>
    {archive && imageUrl && (
      <img
        className={styles.pageImage}
        src={imageUrl}
        alt={`画像 ${page + 1} / ${archive.names.length}`}
        onError={() => setError('画像を読み込めませんでした。')}
      />
    )}
    {loading && <p className={styles.message}>本を開いています…</p>}
    {error && (
      <p className={styles.error} role="alert">
        {error}
      </p>
    )}
  </main>
)

interface LayoutProps {
  file: File
  onClose: () => void
  direction: 'rtl' | 'ltr'
  toc: TocItem[]
  showToc: boolean
  toggleToc: () => void
  goTo: (href: string) => void
  host: React.RefObject<HTMLDivElement | null>
  archive: Archive | null
  imageUrl: string
  page: number
  loading: boolean
  error: string
  setError: (value: string) => void
  progress: number
  turn: (next: boolean) => void
}
const ReaderLayout = ({
  file,
  onClose,
  direction,
  toc,
  showToc,
  toggleToc,
  goTo,
  host,
  archive,
  imageUrl,
  page,
  loading,
  error,
  setError,
  progress,
  turn,
}: LayoutProps) => (
  <section className={styles.reader} aria-label="読書画面">
    <ReaderToolbar
      file={file}
      onClose={onClose}
      direction={direction}
      toc={toc}
      showToc={showToc}
      toggleToc={toggleToc}
      goTo={goTo}
    />
    <ReaderPage
      host={host}
      archive={archive}
      imageUrl={imageUrl}
      page={page}
      loading={loading}
      error={error}
      setError={setError}
    />
    <p className={styles.hint}>
      端をタップ／スワイプ、または矢印キーでページ移動
      {archive ? ` · ${page + 1} / ${archive.names.length}` : ''}
    </p>
    <footer className={styles.footer} dir={direction}>
      <button disabled={loading || Boolean(error)} onClick={() => turn(false)}>
        前へ
      </button>
      <div className={styles.progress}>
        <span>{progress}%</span>
        <div>
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
      <button disabled={loading || Boolean(error)} onClick={() => turn(true)}>
        次へ
      </button>
    </footer>
  </section>
)

const dispose = async (current: Session) => {
  if (current.kind === 'zip') await current.archive.close()
  else {
    current.removeInput()
    current.view.close()
    current.book.destroy()
    current.view.remove()
    await current.reader.close()
  }
}
