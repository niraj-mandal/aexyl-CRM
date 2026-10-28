import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/layout/command-palette";
import { AiCopilotDrawer } from "@/components/crm/AiCopilotDrawer";
import { UndoToaster } from "@/components/ui/undo-toast";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SectionTabs } from "@/components/layout/section-tabs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { hasWorkspaceAccess, requireWorkspace, syncProfileName } from "@/lib/auth/workspace";
import { RoleProvider } from "@/components/providers/role-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (!(await hasWorkspaceAccess())) {
    redirect("/no-access");
  }

  await syncProfileName({ firstName: user.firstName, lastName: user.lastName });
  const { isSales } = await requireWorkspace();

  return (
    <RoleProvider isSales={isSales}>
    <div className="flex h-screen overflow-hidden text-text-primary antialiased font-sans">
      <Sidebar />
      {/* Header scrolls with the page (sticky) so its frosted glass blurs content passing under it. */}
      <div className="flex flex-1 flex-col overflow-y-auto scrollbar-thin">
        <Header userFirstName={user?.firstName} />
        <main className="flex-1 p-6 pb-28 md:p-8 lg:p-10">
          <div className="mx-auto max-w-7xl">
            <SectionTabs />
            {children}
          </div>
        </main>
      </div>
      <CommandPalette />
      <AiCopilotDrawer />
      <UndoToaster />
      <MobileTabBar />
    </div>
    </RoleProvider>
  );
}
