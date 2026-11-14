import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useReaderApp } from '../state/ReaderProvider'
import styles from './index.module.css'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { file, setFile } = useReaderApp()
  const navigate = useNavigate()
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const accept = (selected?: File) => {
    if (!selected) return
    if (!/\.(epub|zip)$/i.test(selected.name)) {
      setMessage('EPUBまたは画像ZIPを選んでください。')
      return
    }
    setMessage('')
    setFile(selected)
  }
  if (file) return null
  return (
    <main className={styles.home}>
      <div className={styles.brand}>
        <span>栞</span>
        <small>SHIORI · BROWSER READER</small>
      </div>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>あなたの本を、あなたの端末で。</p>
        <h1>
          ページをひらいて、
          <br />
          物語の中へ。
        </h1>
        <p>本のデータはこのブラウザーの外へ送られません。</p>
        <div
          className={`${styles.drop} ${dragging ? styles.active : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            accept(event.dataTransfer.files[0])
          }}
        >
          <span className={styles.icon} aria-hidden="true">
            本
          </span>
          <strong>ここに本をドロップ</strong>
          <span>または</span>
          <button onClick={() => input.current?.click()}>ファイルを選ぶ</button>
          <input
            ref={input}
            type="file"
            accept=".epub,.zip,application/epub+zip,application/zip"
            hidden
            onChange={(event) => accept(event.currentTarget.files?.[0])}
          />
          <small>EPUB・画像ZIPに対応</small>
        </div>
        {message && (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        )}
        <div className={styles.notes}>
          <div>
            <b>EPUB</b>
            <span>作品の縦書き・横書き・ルビを尊重</span>
          </div>
          <div>
            <b>画像ZIP</b>
            <span>画像を自然な順序で、画面幅に合わせて表示</span>
          </div>
        </div>
      </section>
      <footer className={styles.foot}>
        <button
          className={styles.settingsLink}
          onClick={() => void navigate({ to: '/config' })}
        >
          設定
        </button>
        <br />
        ファイルは端末内で処理され、保存されません。
        <br />
        <span>
          操作：画面の左右端をタップ · ← → · Space / PageUp / PageDown
        </span>
      </footer>
    </main>
  )
}
