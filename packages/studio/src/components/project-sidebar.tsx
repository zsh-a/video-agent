import type {ProjectSummary} from '../types'

export function ProjectSidebar(props: {onSelect: (projectId: string) => void; projects: ProjectSummary[]; selectedProjectId?: string}) {
  return (
    <aside className="border-r border-line bg-panel px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">Projects</h2>
        <span className="text-xs text-muted">{props.projects.length}</span>
      </div>
      <div className="grid gap-2">
        {props.projects.length === 0 ? <p className="text-sm text-muted">No projects</p> : props.projects.map((project) => (
          <button
            className="rounded-md border border-line bg-white px-3 py-2 text-left transition hover:border-accent data-[selected=true]:border-accent data-[selected=true]:bg-sky-50"
            data-selected={project.projectId === props.selectedProjectId}
            key={project.projectId}
            type="button"
            onClick={() => props.onSelect(project.projectId)}
          >
            <strong className="block text-sm font-semibold">{project.projectId}</strong>
            <span className="mt-1 block text-xs text-muted">{project.status} {project.updatedAt}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
