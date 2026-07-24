import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  FileImage,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import './App.css'

const API_URL = 'https://aahk-apar-service-189323391968.asia-east2.run.app'

type ExtractedField<T> = {
  value: T | null
  confidence: number
  rawText: string | null
  warnings: Array<{ code: string; message: string }>
}

type RecognitionResult = {
  manualReviewRequired: boolean
  text: {
    companyChinese: ExtractedField<string>
    companyEnglish: ExtractedField<string>
    holderChineseFullName: ExtractedField<string>
    holderEnglishSurname: ExtractedField<string>
    holderEnglishOtherNames: ExtractedField<string>
  }
  expiry: ExtractedField<{ isoDate: string; expired: boolean }>
  accessLevel: ExtractedField<string>
  markings: {
    endorsements: ExtractedField<string[]>
    contractor: ExtractedField<boolean>
  }
  warnings: Array<{ code: string; message: string }>
}

type Screen = 'camera' | 'results'

function needsVerification(field: ExtractedField<unknown>, threshold = 0.95) {
  return field.value === null || field.confidence < threshold
}

function fieldValue(value: unknown) {
  if (value === null) return 'Not detected'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None'
  if (typeof value === 'object' && value !== null && 'isoDate' in value) {
    const expiry = value as { isoDate: string; expired: boolean }
    return `${expiry.isoDate}${expiry.expired ? ' (expired)' : ''}`
  }
  return String(value)
}

function ResultField({
  label,
  field,
  threshold,
}: {
  label: string
  field: ExtractedField<unknown>
  threshold?: number
}) {
  const manual = needsVerification(field, threshold)

  return (
    <article className={`result-field${manual ? ' needs-review' : ''}`}>
      <div className="field-heading">
        <span>{label}</span>
        <span className="confidence">{Math.round(field.confidence * 100)}%</span>
      </div>
      <strong>{fieldValue(field.value)}</strong>
      {manual && (
        <p className="review-note">
          <AlertTriangle size={15} aria-hidden="true" />
          Manual verification required
        </p>
      )}
    </article>
  )
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [screen, setScreen] = useState<Screen>('camera')
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [isStartingCamera, setIsStartingCamera] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    if (screen !== 'camera') return

    let cancelled = false
    const startCamera = async () => {
      setIsStartingCamera(true)
      setCameraError('')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        setCameraError('Camera access is unavailable. Choose a photo to continue.')
      } finally {
        if (!cancelled) setIsStartingCamera(false)
      }
    }
    void startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [screen])

  const showResults = (nextResult: RecognitionResult) => {
    setResult(nextResult)
    setScreen('results')
    window.history.pushState(null, '', '#results')
  }

  const processImage = async (image: Blob) => {
    setIsProcessing(true)
    setRequestError('')
    try {
      const form = new FormData()
      form.append('image', image, 'permit-camera.jpg')
      const response = await fetch(`${API_URL}/v1/permits:process`, {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(error?.message ?? 'The permit could not be processed.')
      }
      showResults((await response.json()) as RecognitionResult)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The permit could not be processed.')
    } finally {
      setIsProcessing(false)
    }
  }

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    context?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((image) => image && void processImage(image), 'image/jpeg', 0.94)
  }

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0]
    if (image) void processImage(image)
    event.target.value = ''
  }

  const returnToCamera = () => {
    setResult(null)
    setScreen('camera')
    window.history.pushState(null, '', window.location.pathname)
  }

  if (screen === 'results' && result) {
    const resultFields: Array<{
      label: string
      field: ExtractedField<unknown>
      threshold?: number
    }> = [
      { label: 'Company (Chinese)', field: result.text.companyChinese },
      { label: 'Company (English)', field: result.text.companyEnglish },
      { label: 'Holder name (Chinese)', field: result.text.holderChineseFullName },
      { label: 'Surname', field: result.text.holderEnglishSurname },
      { label: 'Other names', field: result.text.holderEnglishOtherNames },
      { label: 'Expiry date', field: result.expiry },
      { label: 'Access level', field: result.accessLevel, threshold: 0.65 },
      { label: 'Endorsements', field: result.markings.endorsements },
      { label: 'Contractor', field: result.markings.contractor },
    ]
    const reviewCount = resultFields.filter(({ field, threshold }) => needsVerification(field, threshold)).length

    return (
      <main className="app-shell results-screen">
        <header className="app-header compact">
          <button className="icon-button" type="button" onClick={returnToCamera} aria-label="Capture another permit">
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <div>
            <p className="eyebrow">ARA permit scan</p>
            <h1>Review results</h1>
          </div>
          <ShieldCheck size={28} aria-hidden="true" />
        </header>

        <section className={`review-banner${reviewCount ? '' : ' verified'}`}>
          {reviewCount ? <AlertTriangle size={22} aria-hidden="true" /> : <ShieldCheck size={22} aria-hidden="true" />}
          <div>
            <strong>{reviewCount ? `${reviewCount} fields need review` : 'All fields cleared'}</strong>
            <p>{reviewCount ? 'Verify highlighted values against the physical permit.' : 'Confidence thresholds were met.'}</p>
          </div>
        </section>

        <section className="result-list" aria-label="Permit recognition results">
          {resultFields.map(({ label, field, threshold }) => (
            <ResultField key={label} label={label} field={field} threshold={threshold} />
          ))}
        </section>

        {result.warnings.length > 0 && (
          <section className="server-warnings" aria-label="Scan warnings">
            <h2>Scan warnings</h2>
            {result.warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
          </section>
        )}

        <button className="secondary-action" type="button" onClick={returnToCamera}>
          <RefreshCw size={19} aria-hidden="true" />
          Scan another permit
        </button>
      </main>
    )
  }

  return (
    <main className="app-shell capture-screen">
      <header className="app-header">
        <div>
          <p className="eyebrow">Airport Restricted Area</p>
          <h1>Scan permit</h1>
        </div>
        <ShieldCheck size={29} aria-hidden="true" />
      </header>

      <section className="camera-stage" aria-label="Camera preview">
        <video ref={videoRef} muted playsInline autoPlay />
        <img className="permit-overlay" src="/ARA Permit Template.png" alt="Permit alignment guide" />
        {isStartingCamera && (
          <div className="camera-status"><LoaderCircle className="spin" size={24} aria-hidden="true" /> Opening camera</div>
        )}
        {cameraError && <div className="camera-status error">{cameraError}</div>}
      </section>

      <section className="capture-panel">
        <p>Fit the permit inside the guide, keeping all four corners visible.</p>
        {requestError && <p className="request-error">{requestError}</p>}
        <div className="capture-actions">
          <button className="utility-button" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Choose existing permit photo">
            <FileImage size={22} aria-hidden="true" />
          </button>
          <button className="capture-button" type="button" onClick={capturePhoto} disabled={isStartingCamera || isProcessing}>
            {isProcessing ? <LoaderCircle className="spin" size={25} aria-hidden="true" /> : <Camera size={25} aria-hidden="true" />}
            {isProcessing ? 'Processing' : 'Capture permit'}
          </button>
          <span className="button-spacer" aria-hidden="true" />
        </div>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choosePhoto} />
      </section>
    </main>
  )
}

export default App
