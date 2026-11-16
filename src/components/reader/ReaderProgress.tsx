import styles from '#components/reader/Reader.module.css'
import {
  progressLocation,
  progressRemaining,
  progressValue,
} from '#lib/reader/progress'

interface ReaderProgressProps {
  count: number
  currentIndex: number
  indices: number[]
  progress: number
  atEnd: boolean
  loading: boolean
  unavailable: boolean
  direction: 'ltr' | 'rtl'
}

export const ReaderProgress = ({
  count,
  currentIndex,
  indices,
  progress,
  atEnd,
  loading,
  unavailable,
  direction,
}: ReaderProgressProps) => {
  if (loading || unavailable)
    return (
      <div className={styles.progress}>
        <span className={styles.progressMessage}>
          {loading ? '準備中' : '進捗を表示できません'}
        </span>
        <div className={styles.progressTrack} aria-hidden="true" />
      </div>
    )

  const value = progressValue(progress, atEnd)
  const location = progressLocation(count, currentIndex, indices)
  const remaining = progressRemaining(count, currentIndex, indices)
  const detail = atEnd ? '最終ページ' : remaining
  const valueText = [location, `${value}%`, detail].filter(Boolean).join('、')
  return (
    <div className={styles.progress}>
      <div className={styles.progressHeading}>
        <span dir="ltr">{location}</span>
        <span className={styles.progressPercent} dir="ltr">
          {value}%
        </span>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="読書の進捗"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={valueText}
        dir={direction}
      >
        <span className={styles.progressFill} style={{ width: `${value}%` }} />
      </div>
      <span className={styles.progressDetail}>{detail || '\u00a0'}</span>
    </div>
  )
}
