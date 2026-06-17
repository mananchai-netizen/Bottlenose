import { readFileSync, existsSync } from 'node:fs'
import { google } from 'googleapis'

function getAuth() {
  const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON
  if (!clientJson) throw new Error('GOOGLE_OAUTH_CLIENT_JSON is not set')

  const clientCfg = (JSON.parse(clientJson) as { installed?: { client_id?: string; client_secret?: string }; web?: { client_id?: string; client_secret?: string } }).installed ?? (JSON.parse(clientJson) as { web?: { client_id?: string; client_secret?: string } }).web
  if (!clientCfg?.client_id || !clientCfg.client_secret) throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON')

  const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret)

  // Prefer inline JSON (Vercel), fall back to file path (local dev)
  const tokenJson = process.env.GOOGLE_OAUTH_TOKEN_JSON
  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
  if (tokenJson) {
    oauth2.setCredentials(JSON.parse(tokenJson) as object)
  } else if (tokenPath && existsSync(tokenPath)) {
    oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')) as object)
  } else {
    throw new Error('Google OAuth token not found: set GOOGLE_OAUTH_TOKEN_JSON or GOOGLE_OAUTH_TOKEN_PATH')
  }

  return oauth2
}

export async function createGoogleDoc(folderId: string, title: string, content: string): Promise<string> {
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })
  const docs = google.docs({ version: 'v1', auth })

  const file = await drive.files.create({
    requestBody: { name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
    fields: 'id, webViewLink',
  })
  const fileId = file.data.id
  if (!fileId) throw new Error('Google Drive did not return file id for doc')

  if (content.length > 0) {
    await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] },
    })
  }

  return file.data.webViewLink ?? `https://docs.google.com/document/d/${fileId}/edit`
}

export async function createGoogleSheet(folderId: string, title: string, csvContent: string): Promise<string> {
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })
  const sheets = google.sheets({ version: 'v4', auth })

  const file = await drive.files.create({
    requestBody: { name: title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folderId] },
    fields: 'id, webViewLink',
  })
  const fileId = file.data.id
  if (!fileId) throw new Error('Google Drive did not return file id for sheet')

  const rows = csvContent.trim().split('\n').map(row =>
    row.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
  )

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: fileId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    })
  }

  return file.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${fileId}/edit`
}

export async function createGoogleSlides(folderId: string, title: string, slidesMarkdown: string): Promise<string> {
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })
  const slidesApi = google.slides({ version: 'v1', auth })

  const file = await drive.files.create({
    requestBody: { name: title, mimeType: 'application/vnd.google-apps.presentation', parents: [folderId] },
    fields: 'id, webViewLink',
  })
  const fileId = file.data.id
  if (!fileId) throw new Error('Google Drive did not return file id for slides')

  const slideBlocks = slidesMarkdown.split(/\n---\n/).map(block => block.trim()).filter(Boolean)
  const presentation = await slidesApi.presentations.get({
    presentationId: fileId,
    fields: 'slides.objectId',
  })
  const firstSlideId = presentation.data.slides?.[0]?.objectId

  const requests: object[] = []
  if (firstSlideId) requests.push({ deleteObject: { objectId: firstSlideId } })

  slideBlocks.forEach((block, index) => {
    const lines = block.split('\n')
    const titleLine = lines[0]?.replace(/^#+\s*/, '') ?? ''
    const bullets = lines.slice(1).filter(l => l.trim()).map(l => l.replace(/^[-*]\s*/, ''))

    const slideId = `han_slide_${index}`
    const titleId = `han_title_${index}`
    const bodyId = `han_body_${index}`

    requests.push({
      createSlide: {
        objectId: slideId,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId },
        ],
      },
    })
    if (titleLine) requests.push({ insertText: { objectId: titleId, text: titleLine } })
    const bodyText = bullets.join('\n')
    if (bodyText) {
      requests.push({ insertText: { objectId: bodyId, text: bodyText } })
      requests.push({ createParagraphBullets: { objectId: bodyId, textRange: { type: 'ALL' }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } })
    }
  })

  if (requests.length > 0) {
    await slidesApi.presentations.batchUpdate({
      presentationId: fileId,
      requestBody: { requests },
    })
  }

  return file.data.webViewLink ?? `https://docs.google.com/presentation/d/${fileId}/edit`
}
