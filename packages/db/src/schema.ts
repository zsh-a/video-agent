export interface ProjectRecord {
  createdAt: string
  id: string
  title: string
  workspaceDir: string
}

export interface JobRecord {
  createdAt: string
  id: string
  projectId: string
  stage: string
  status: string
  updatedAt: string
}
