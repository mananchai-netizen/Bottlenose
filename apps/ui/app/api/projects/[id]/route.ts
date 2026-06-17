import { NextResponse } from 'next/server';
import { getProjects, saveProject, deleteProject } from '@/lib/config';
import type { ProjectConfig } from '@/lib/types';

type Params = Promise<{ id: string }>;

export async function GET(_req: Request, { params }: { params: Params }) {
  const { id } = await params;
  const project = (await getProjects()).find((p) => p.project_id === id);
  if (project === undefined) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<ProjectConfig>;
  const existing = (await getProjects()).find((p) => p.project_id === id);
  if (existing === undefined) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await saveProject({ ...existing, ...body, project_id: id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { id } = await params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
