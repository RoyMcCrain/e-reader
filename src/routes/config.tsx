import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useReaderApp } from '../state/ReaderProvider'
import { DEFAULT_SETTINGS, type ReaderSettings } from '../reader/preferences'
import styles from './config.module.css'

export const Route = createFileRoute('/config')({ component: Config })

interface NumericSettingProps {
  label: string
  field: keyof ReaderSettings
  min: number
  max: number
  step: number
  unit: string
  value: number
  onChange: (field: keyof ReaderSettings, value: number) => void
}

const NumericSetting = ({
  label,
  field,
  min,
  max,
  step,
  unit,
  value,
  onChange,
}: NumericSettingProps) => {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const parsed = Number(draft)
    const next =
      draft.trim() && Number.isFinite(parsed)
        ? Math.min(max, Math.max(min, parsed))
        : value
    onChange(field, next)
    setDraft(String(next))
  }
  return (
    <div className={styles.numericSetting}>
      <label htmlFor={`setting-${field}`}>{label}</label>
      <div className={styles.control}>
        <input
          id={`setting-${field}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            setDraft(String(next))
            onChange(field, next)
          }}
        />
        <span className={styles.value}>
          <input
            aria-label={`${label}の値`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          {unit}
        </span>
      </div>
    </div>
  )
}

function Config() {
  const { settings, updateSettings, resetSettings, file } = useReaderApp()
  const navigate = useNavigate()
  const setNumber = (field: keyof ReaderSettings, value: number) =>
    updateSettings({ [field]: value })
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button
          className={styles.back}
          onClick={() => void navigate({ to: '/' })}
          aria-label={file ? '読書に戻る' : '戻る'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6M9 12h11" />
          </svg>
          <span>{file ? '読書に戻る' : '戻る'}</span>
        </button>
        <h1>設定</h1>
      </header>
      <section className={styles.group} aria-labelledby="display-heading">
        <h2 id="display-heading">表示</h2>
        <label className={styles.selectSetting}>
          <span>見開き</span>
          <select
            value={settings.spread}
            onChange={(event) =>
              updateSettings({
                spread: event.currentTarget.value as ReaderSettings['spread'],
              })
            }
          >
            <option value="auto">自動</option>
            <option value="single">1ページ</option>
            <option value="double">見開き</option>
          </select>
        </label>
        <label className={styles.selectSetting}>
          <span>書体</span>
          <select
            value={settings.fontFamily}
            onChange={(event) =>
              updateSettings({
                fontFamily: event.currentTarget
                  .value as ReaderSettings['fontFamily'],
              })
            }
          >
            <option value="publisher">書籍指定</option>
            <option value="serif">端末の明朝体</option>
            <option value="sans-serif">端末のゴシック体</option>
          </select>
        </label>
        <NumericSetting
          label="文字サイズ"
          field="fontSize"
          min={12}
          max={36}
          step={1}
          unit="px"
          value={settings.fontSize}
          onChange={setNumber}
        />
        <NumericSetting
          label="行間"
          field="lineHeight"
          min={1.2}
          max={2.4}
          step={0.1}
          unit=""
          value={settings.lineHeight}
          onChange={setNumber}
        />
      </section>
      <section className={styles.group} aria-labelledby="margin-heading">
        <h2 id="margin-heading">余白</h2>
        <NumericSetting
          label="上"
          field="marginTop"
          min={0}
          max={96}
          step={1}
          unit="px"
          value={settings.marginTop}
          onChange={setNumber}
        />
        <NumericSetting
          label="右"
          field="marginRight"
          min={0}
          max={96}
          step={1}
          unit="px"
          value={settings.marginRight}
          onChange={setNumber}
        />
        <NumericSetting
          label="下"
          field="marginBottom"
          min={0}
          max={96}
          step={1}
          unit="px"
          value={settings.marginBottom}
          onChange={setNumber}
        />
        <NumericSetting
          label="左"
          field="marginLeft"
          min={0}
          max={96}
          step={1}
          unit="px"
          value={settings.marginLeft}
          onChange={setNumber}
        />
      </section>
      <section className={styles.group} aria-labelledby="spread-heading">
        <h2 id="spread-heading">見開き</h2>
        <NumericSetting
          label="ページ間隔"
          field="gutter"
          min={0}
          max={64}
          step={1}
          unit="px"
          value={settings.gutter}
          onChange={setNumber}
        />
      </section>
      <button className={styles.reset} onClick={resetSettings}>
        初期設定に戻す
      </button>
      <span className={styles.srOnly}>
        初期値: {DEFAULT_SETTINGS.fontSize}px
      </span>
    </main>
  )
}
