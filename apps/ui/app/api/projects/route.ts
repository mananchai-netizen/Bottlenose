import { NextResponse } from 'next/server';
import { getProjects, saveProject } from '@/lib/config';
import type { ProjectConfig } from '@/lib/types';

export async function GET() {
  return NextResponse.json(await getProjects());
}

export async function POST(request: Request) {
  const body = (await request.json()) as ProjectConfig;
  if (!body.project_id || !body.project_name || !body.notion_db_id) {
    return NextResponse.json({ error: 'project_id, project_name, notion_db_id required' }, { status: 400 });
  }
  await saveProject(body);
  return NextResponse.json({ ok: true });
}
