import os from 'node:os';
import path, { resolve, extname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { google, type sheets_v4, type slides_v1 } from 'googleapis';
import { materializeGoogleCredentialsFromEnv } from '../config.js';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

export type SheetCellValue = string | number | boolean | null;

export interface DriveSheetTab {
  name: string;
  rows: SheetCellValue[][];
}

export interface DrivePresentationSlide {
  title: string;
  bullets: string[];
}

const MAX_CONTENT_CHARS = 10_000;
const OAUTH_CLIENT_PATH = path.join(os.homedir(), '.han', 'google-oauth-client.json');
const OAUTH_TOKEN_PATH = path.join(os.homedir(), '.han', 'google-oauth-token.json');
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
];

// Google Drive / Docs / Sheets / Slides resource IDs are base64url strings, 25-44 chars
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{25,44}$/;

export interface GoogleDriveClientOptions {
  keyPath?: string;
  oauthClientPath?: string;
  oauthTokenPath?: string;
}

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function validateDriveId(id: string, label: string): void {
  if (!DRIVE_ID_RE.test(id)) {
    throw new Error(`Invalid ${label} format: ${id}`);
  }
}

function formatSheetRangeName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function createOAuthClient(
  clientPath: string = OAUTH_CLIENT_PATH,
  tokenPath: string = OAUTH_TOKEN_PATH,
): InstanceType<typeof google.auth.OAuth2> | null {
  if (!existsSync(clientPath) || !existsSync(tokenPath)) {
    return null;
  }

  const credentials = JSON.parse(readFileSync(clientPath, 'utf8')) as {
    installed?: { client_id?: string; client_secret?: string; redirect_uris?: string[] };
    web?: { client_id?: string; client_secret?: string; redirect_uris?: string[] };
  };
  const clientConfig = credentials.installed ?? credentials.web;
  if (clientConfig?.client_id === undefined || clientConfig.client_secret === undefined) {
    throw new Error(`Invalid Google OAuth client file: ${clientPath}`);
  }

  const redirectUri = clientConfig.redirect_uris?.[0] ?? 'http://127.0.0.1:53682/oauth2callback';
  const oauth2Client = new google.auth.OAuth2(
    clientConfig.client_id,
    clientConfig.client_secret,
    redirectUri,
  );
  oauth2Client.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));
  return oauth2Client;
}

export class GoogleDriveClient {
  private readonly keyPath: string | undefined;
  // Single auth client shared across all API calls; googleapis handles token caching internally
  private readonly authClient: InstanceType<typeof google.auth.GoogleAuth> | InstanceType<typeof google.auth.OAuth2>;

  constructor(options: string | GoogleDriveClientOptions) {
    const materialized = materializeGoogleCredentialsFromEnv();
    const keyPath = typeof options === 'string' ? options : options.keyPath;
    const useLegacyOAuthDefaults = typeof options === 'string';
    const oauthClientPath = typeof options === 'string'
      ? materialized.oauthClientPath ?? OAUTH_CLIENT_PATH
      : options.oauthClientPath ?? materialized.oauthClientPath;
    const oauthTokenPath = typeof options === 'string'
      ? materialized.oauthTokenPath ?? OAUTH_TOKEN_PATH
      : options.oauthTokenPath ?? materialized.oauthTokenPath;

    const oauthClient = oauthTokenPath !== undefined
      ? createOAuthClient(
        oauthClientPath !== undefined ? resolve(expandHome(oauthClientPath)) : OAUTH_CLIENT_PATH,
        resolve(expandHome(oauthTokenPath)),
      )
      : useLegacyOAuthDefaults
        ? createOAuthClient(OAUTH_CLIENT_PATH, OAUTH_TOKEN_PATH)
        : null;

    if (oauthClient !== null) {
      this.keyPath = undefined;
      this.authClient = oauthClient;
    } else {
      if (keyPath === undefined || keyPath.trim().length === 0) {
        throw new Error('Missing "google_key_path"');
      }
      const abs = resolve(expandHome(keyPath));
      if (extname(abs) !== '.json') {
        throw new Error(`google_key_path must be a .json file, got: ${abs}`);
      }
      if (!existsSync(abs)) {
        throw new Error(`google_key_path not found: ${abs}`);
      }
      this.keyPath = abs;
      this.authClient = new google.auth.GoogleAuth({
        keyFile: abs,
        scopes: GOOGLE_SCOPES,
      });
    }
  }

  async listFiles(folderId: string): Promise<DriveFile[]> {
    validateDriveId(folderId, 'folderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 100,
        ...(pageToken !== undefined ? { pageToken } : {}),
      });
      for (const f of res.data.files ?? []) {
        files.push(f as DriveFile);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken !== undefined);

    return files;
  }

  async getFolder(folderId: string): Promise<DriveFolder> {
    validateDriveId(folderId, 'folderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType, webViewLink',
    });

    if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`Google Drive item is not a folder: ${folderId}`);
    }

    return {
      id: res.data.id ?? folderId,
      name: res.data.name ?? '(unnamed folder)',
      ...(res.data.webViewLink !== null && res.data.webViewLink !== undefined
        ? { webViewLink: res.data.webViewLink }
        : {}),
    };
  }

  async findFolder(parentFolderId: string, name: string): Promise<DriveFolder | null> {
    validateDriveId(parentFolderId, 'parentFolderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const res = await drive.files.list({
      q: [
        `'${parentFolderId}' in parents`,
        `name = '${safeName}'`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id, name, webViewLink)',
      pageSize: 1,
    });

    const folder = res.data.files?.[0];
    if (folder === undefined || folder.id === null || folder.id === undefined) {
      return null;
    }

    return {
      id: folder.id,
      name: folder.name ?? name,
      ...(folder.webViewLink !== null && folder.webViewLink !== undefined
        ? { webViewLink: folder.webViewLink }
        : {}),
    };
  }

  async createFolder(parentFolderId: string, name: string): Promise<DriveFolder> {
    validateDriveId(parentFolderId, 'parentFolderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id, name, webViewLink',
    });

    if (res.data.id === null || res.data.id === undefined) {
      throw new Error(`Google Drive did not return an id for folder: ${name}`);
    }

    return {
      id: res.data.id,
      name: res.data.name ?? name,
      ...(res.data.webViewLink !== null && res.data.webViewLink !== undefined
        ? { webViewLink: res.data.webViewLink }
        : {}),
    };
  }

  async ensureFolder(parentFolderId: string, name: string): Promise<DriveFolder> {
    return (await this.findFolder(parentFolderId, name)) ?? this.createFolder(parentFolderId, name);
  }

  async createDoc(parentFolderId: string, title: string, content: string): Promise<DriveFile> {
    validateDriveId(parentFolderId, 'parentFolderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const docs = google.docs({ version: 'v1', auth: this.authClient });
    const res = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [parentFolderId],
      },
      fields: 'id, name, mimeType, webViewLink',
    });

    if (res.data.id === null || res.data.id === undefined) {
      throw new Error(`Google Drive did not return an id for doc: ${title}`);
    }

    if (content.length > 0) {
      await docs.documents.batchUpdate({
        documentId: res.data.id,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      });
    }

    return {
      id: res.data.id,
      name: res.data.name ?? title,
      mimeType: res.data.mimeType ?? 'application/vnd.google-apps.document',
      ...(res.data.webViewLink !== null && res.data.webViewLink !== undefined
        ? { webViewLink: res.data.webViewLink }
        : {}),
    };
  }

  async sharePublicRead(fileId: string): Promise<void> {
    validateDriveId(fileId, 'fileId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'anyone',
        role: 'reader',
      },
      fields: 'id',
    });
  }

  async createSheet(parentFolderId: string, title: string, tabs: DriveSheetTab[]): Promise<DriveFile> {
    validateDriveId(parentFolderId, 'parentFolderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const sheets = google.sheets({ version: 'v4', auth: this.authClient });

    const file = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [parentFolderId],
      },
      fields: 'id, name, mimeType, webViewLink',
    });

    if (file.data.id === null || file.data.id === undefined) {
      throw new Error(`Google Sheets did not return an id for sheet: ${title}`);
    }

    const fileId = file.data.id;
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: fileId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const firstSheetId = spreadsheet.data.sheets?.[0]?.properties?.sheetId;
    const sheetRequests: sheets_v4.Schema$Request[] = [];
    tabs.forEach((tab, index) => {
      if (index === 0 && firstSheetId !== null && firstSheetId !== undefined) {
        sheetRequests.push({
          updateSheetProperties: {
            properties: { sheetId: firstSheetId, title: tab.name },
            fields: 'title',
          },
        });
      } else {
        sheetRequests.push({
          addSheet: {
            properties: { title: tab.name },
          },
        });
      }
    });

    if (sheetRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: fileId,
        requestBody: { requests: sheetRequests },
      });
    }

    for (const tab of tabs) {
      if (tab.rows.length === 0) continue;
      await sheets.spreadsheets.values.update({
        spreadsheetId: fileId,
        range: `${formatSheetRangeName(tab.name)}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: tab.rows },
      });
    }

    return {
      id: fileId,
      name: file.data.name ?? title,
      mimeType: file.data.mimeType ?? 'application/vnd.google-apps.spreadsheet',
      ...(file.data.webViewLink !== null && file.data.webViewLink !== undefined
        ? { webViewLink: file.data.webViewLink }
        : {}),
    };
  }

  async createSlide(
    parentFolderId: string,
    title: string,
    presentationSlides: DrivePresentationSlide[],
  ): Promise<DriveFile> {
    validateDriveId(parentFolderId, 'parentFolderId');
    const drive = google.drive({ version: 'v3', auth: this.authClient });
    const slides = google.slides({ version: 'v1', auth: this.authClient });

    const file = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.presentation',
        parents: [parentFolderId],
      },
      fields: 'id, name, mimeType, webViewLink',
    });

    if (file.data.id === null || file.data.id === undefined) {
      throw new Error(`Google Slides did not return an id for presentation: ${title}`);
    }

    const fileId = file.data.id;
    const presentation = await slides.presentations.get({
      presentationId: fileId,
      fields: 'slides.objectId',
    });

    const requests: slides_v1.Schema$Request[] = [];
    const firstSlideId = presentation.data.slides?.[0]?.objectId;
    if (firstSlideId !== null && firstSlideId !== undefined) {
      requests.push({ deleteObject: { objectId: firstSlideId } });
    }

    presentationSlides.forEach((slide, index) => {
      const slideId = `han_slide_${index}`;
      const titleId = `han_title_${index}`;
      const bodyId = `han_body_${index}`;
      const bodyText = slide.bullets.join('\n');

      requests.push({
        createSlide: {
          objectId: slideId,
          slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
          placeholderIdMappings: [
            { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
            { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId },
          ],
        },
      });
      requests.push({
        insertText: {
          objectId: titleId,
          text: slide.title,
        },
      });

      if (bodyText.length > 0) {
        requests.push({
          insertText: {
            objectId: bodyId,
            text: bodyText,
          },
        });
        requests.push({
          createParagraphBullets: {
            objectId: bodyId,
            textRange: { type: 'ALL' },
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
          },
        });
      }
    });

    if (requests.length > 0) {
      await slides.presentations.batchUpdate({
        presentationId: fileId,
        requestBody: { requests },
      });
    }

    return {
      id: fileId,
      name: file.data.name ?? title,
      mimeType: file.data.mimeType ?? 'application/vnd.google-apps.presentation',
      ...(file.data.webViewLink !== null && file.data.webViewLink !== undefined
        ? { webViewLink: file.data.webViewLink }
        : {}),
    };
  }

  async getDocContent(fileId: string): Promise<string> {
    validateDriveId(fileId, 'fileId');
    const docs = google.docs({ version: 'v1', auth: this.authClient });
    const res = await docs.documents.get({ documentId: fileId });
    const parts: string[] = [];
    for (const el of res.data.body?.content ?? []) {
      for (const pe of el.paragraph?.elements ?? []) {
        // googleapis types are not fully typed at depth — typed cast is intentional here
        const text = (pe as { textRun?: { content?: string } }).textRun?.content;
        if (text) parts.push(text);
      }
    }
    const full = parts.join('');
    return full.length > MAX_CONTENT_CHARS
      ? full.slice(0, MAX_CONTENT_CHARS) + '...[truncated]'
      : full;
  }

  async getSheetContent(fileId: string): Promise<string> {
    validateDriveId(fileId, 'fileId');
    const sheets = google.sheets({ version: 'v4', auth: this.authClient });
    // No explicit range — returns all data from the first sheet; multi-sheet support is a future enhancement
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: 'A1:ZZ1000',
    });
    const full = (res.data.values ?? []).map((row) => row.join('\t')).join('\n');
    return full.length > MAX_CONTENT_CHARS
      ? full.slice(0, MAX_CONTENT_CHARS) + '...[truncated]'
      : full;
  }

  async getSlideContent(fileId: string): Promise<string> {
    validateDriveId(fileId, 'fileId');
    const slides = google.slides({ version: 'v1', auth: this.authClient });
    const res = await slides.presentations.get({ presentationId: fileId });
    const parts: string[] = [];
    for (const slide of res.data.slides ?? []) {
      for (const element of slide.pageElements ?? []) {
        // Only text shapes are extracted; images, tables, charts, speaker notes are not available
        const textElements = (
          element.shape?.text as
            | { textElements?: Array<{ textRun?: { content?: string } }> }
            | undefined
        )?.textElements ?? [];
        for (const te of textElements) {
          const text = te.textRun?.content;
          if (text) parts.push(text);
        }
      }
    }
    const full = parts.join('\n');
    return full.length > MAX_CONTENT_CHARS
      ? full.slice(0, MAX_CONTENT_CHARS) + '...[truncated]'
      : full;
  }
}
