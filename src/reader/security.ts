const blockedTags =
  'script, iframe, frame, frameset, object, embed, form, base, portal'
const navigationAttributes = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'background',
])
const policy =
  "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:;"

const normalizedUrl = (value: string) =>
  value
    .trim()
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase()
const isUnsafeNavigation = (value: string) => {
  const url = normalizedUrl(value)
  return (
    url.startsWith('//') ||
    /^(javascript|vbscript|data|file|filesystem|https?):/.test(url)
  )
}
const isImageData = (value: string) =>
  /^data:image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)(?:;|,)/i.test(
    normalizedUrl(value),
  )

const sanitizeCss = (css: string) =>
  css
    .replace(/@import\b(?!\s+(?:url\(\s*)?['"]?blob:)[^;]*(?:;|$)/gi, '')
    .replace(
      /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
      (match, _quote: string, rawUrl: string) => {
        const url = normalizedUrl(rawUrl)
        return /^(blob:|data:|#)/.test(url) ? match : 'none'
      },
    )

const removeProcessingInstructions = (doc: Document) => {
  const walker = doc.createTreeWalker(
    doc,
    NodeFilter.SHOW_PROCESSING_INSTRUCTION,
  )
  const instructions: Node[] = []
  let node = walker.nextNode()
  while (node) {
    instructions.push(node)
    node = walker.nextNode()
  }
  instructions.forEach((instruction) =>
    instruction.parentNode?.removeChild(instruction),
  )
}

const removeExecutableContent = (doc: Document) => {
  removeProcessingInstructions(doc)
  doc.querySelectorAll(blockedTags).forEach((element) => element.remove())
  doc
    .querySelectorAll('meta[http-equiv], link[rel="import"]')
    .forEach((element) => element.remove())
  doc
    .querySelectorAll(
      'foreignObject, animate, animateMotion, animateTransform, set, discard',
    )
    .forEach((element) => element.remove())
}

const sanitizeSrcset = (value: string) =>
  value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      const url = candidate.split(/\s+/, 1)[0]
      return url && !isUnsafeNavigation(url)
    })
    .join(', ')

const isExecutableAttribute = (name: string) =>
  name.startsWith('on') || name === 'srcdoc' || name === 'ping'

const sanitizeSrcsetAttribute = (element: Element, attribute: Attr) => {
  const safe = sanitizeSrcset(attribute.value)
  if (safe) element.setAttribute(attribute.name, safe)
  else element.removeAttribute(attribute.name)
}

const allowsImageData = (element: Element, name: string, value: string) =>
  (name === 'src' && element.localName === 'img' && isImageData(value)) ||
  ((name === 'href' || name === 'xlink:href') &&
    element.namespaceURI === 'http://www.w3.org/2000/svg' &&
    element.localName === 'image' &&
    isImageData(value))

const sanitizeAttribute = (element: Element, attribute: Attr) => {
  const name = attribute.name.toLowerCase()
  const value = attribute.value
  if (isExecutableAttribute(name)) element.removeAttribute(attribute.name)
  else if (name === 'srcset') sanitizeSrcsetAttribute(element, attribute)
  else if (
    navigationAttributes.has(name) &&
    isUnsafeNavigation(value) &&
    !allowsImageData(element, name, value)
  ) {
    element.removeAttribute(attribute.name)
  } else if (name === 'style') {
    element.setAttribute(attribute.name, sanitizeCss(value))
  }
}

const sanitizeAttributes = (doc: Document) => {
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes])
      sanitizeAttribute(element, attribute)
  }
  doc.querySelectorAll('style').forEach((style) => {
    style.textContent = sanitizeCss(style.textContent ?? '')
  })
}

const applyPolicy = (doc: Document) => {
  const root = doc.documentElement
  const namespace = root.namespaceURI
  const head =
    doc.querySelector('head') ??
    root.insertBefore(doc.createElementNS(namespace, 'head'), root.firstChild)
  const meta = doc.createElementNS(namespace, 'meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', policy)
  head.prepend(meta)
}

export const secureDocument = (
  source: string,
  type = 'application/xhtml+xml',
) => {
  const html = type.split(';', 1)[0].trim().toLowerCase() === 'text/html'
  const svg = type.split(';', 1)[0].trim().toLowerCase() === 'image/svg+xml'
  const doc = new DOMParser().parseFromString(
    source,
    html ? 'text/html' : 'application/xhtml+xml',
  )
  if (!html && doc.querySelector('parsererror'))
    throw new Error('EPUBの本文を安全に読み込めませんでした。')
  removeExecutableContent(doc)
  sanitizeAttributes(doc)
  if (!svg) applyPolicy(doc)
  return new XMLSerializer().serializeToString(doc)
}
