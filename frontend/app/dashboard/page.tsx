import { BriefcaseIcon } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { JobsKanban } from "@/components/jobs-kanban"

export default function JobsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="flex items-center gap-1.5">
                <BriefcaseIcon className="size-3.5" />
                Jobs
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>
      <div className="overflow-x-auto overflow-y-hidden px-6 py-4 h-[calc(100svh-3.5rem)]">
        <JobsKanban />
      </div>
    </div>
  )
}
